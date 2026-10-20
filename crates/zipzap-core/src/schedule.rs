use super::*;
use jiff::{
    Timestamp,
    civil::Date,
    tz::{AmbiguousOffset, TimeZone},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScheduleTiming {
    Once { date: String },
    Weekly { weekdays: Vec<i8> },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Schedule {
    pub timing: ScheduleTiming,
    pub start_minute: u16,
    pub stop_minute: u16,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Saved {
    pub config: Option<Schedule>,
    pub processed_through: i64,
    pub last_start_date: Option<String>,
}

pub(super) struct Runtime {
    saved: Saved,
    observed: Option<(i64, TimeZone)>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScheduleState {
    pub config: Option<Schedule>,
    pub next_start: Option<i64>,
    pub time_zone: String,
    pub error: Option<String>,
}

fn date(value: &str) -> Result<Date> {
    let parsed: Date = value.parse().map_err(|_| "Invalid schedule date")?;
    if !(1970..=9998).contains(&parsed.year()) || parsed.to_string() != value {
        return Err("Invalid schedule date".into());
    }
    Ok(parsed)
}

impl Schedule {
    fn validate(&self) -> Result<()> {
        if self.start_minute >= 1440
            || self.stop_minute >= 1440
            || self.start_minute == self.stop_minute
        {
            return Err("Choose different valid start and hold times".into());
        }
        match &self.timing {
            ScheduleTiming::Once { date: value } => {
                date(value)?;
            }
            ScheduleTiming::Weekly { weekdays } => {
                if weekdays.is_empty()
                    || weekdays.len() > 7
                    || weekdays
                        .iter()
                        .enumerate()
                        .any(|(i, day)| !(1..=7).contains(day) || weekdays[..i].contains(day))
                {
                    return Err("Choose distinct weekdays from Monday through Sunday".into());
                }
            }
        }
        Ok(())
    }

    fn window(&self, day: Date, zone: &TimeZone) -> Option<(i64, i64)> {
        let selected = match &self.timing {
            ScheduleTiming::Once { date } => *date == day.to_string(),
            ScheduleTiming::Weekly { weekdays } => {
                weekdays.contains(&day.weekday().to_monday_one_offset())
            }
        };
        if !selected {
            return None;
        }
        let start = zone.to_ambiguous_zoned(day.at(
            (self.start_minute / 60) as i8,
            (self.start_minute % 60) as i8,
            0,
            0,
        ));
        if matches!(start.offset(), AmbiguousOffset::Gap { .. }) {
            return None;
        }
        let stop_day = if self.stop_minute < self.start_minute {
            day.tomorrow().ok()?
        } else {
            day
        };
        let stop = zone.to_ambiguous_zoned(stop_day.at(
            (self.stop_minute / 60) as i8,
            (self.stop_minute % 60) as i8,
            0,
            0,
        ));
        Some((
            start.earlier().ok()?.timestamp().as_second(),
            stop.compatible().ok()?.timestamp().as_second(),
        ))
    }

    fn days(&self, today: Date, past: bool) -> Vec<Date> {
        if let ScheduleTiming::Once { date: value } = &self.timing {
            return date(value).into_iter().collect();
        }
        (0..=8)
            .filter_map(|offset| {
                today
                    .checked_add(jiff::Span::new().days(if past { -offset } else { offset }))
                    .ok()
            })
            .collect()
    }
}

fn write(state: &mut State, running: bool, saved: Saved) -> Result<()> {
    let tx = state.db.transaction().map_err(db_error)?;
    let changed = tx
        .execute("UPDATE queue SET running=?1 WHERE id=1", [running])
        .map_err(db_error)?;
    if changed != 1 {
        return Err("Saved queue state is missing; repair storage before retrying".into());
    }
    let changed = tx
        .execute(
            "UPDATE schedule SET data=?1 WHERE id=1",
            [serde_json::to_string(&saved).map_err(json_error)?],
        )
        .map_err(db_error)?;
    if changed != 1 {
        return Err("Saved schedule is missing; repair storage before retrying".into());
    }
    tx.commit().map_err(db_error)?;
    state.queue_running = running;
    state.schedule.saved = saved;
    state.schedule.error = None;
    Ok(())
}

pub(super) fn load(
    tx: &rusqlite::Transaction<'_>,
    schema: i64,
    running: &mut bool,
) -> Result<Runtime> {
    tx.execute_batch("CREATE TABLE IF NOT EXISTS schedule(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);").map_err(db_error)?;
    if schema < 5 {
        tx.execute(
            "INSERT INTO schedule VALUES(1,?1)",
            [serde_json::to_string(&Saved::default()).map_err(json_error)?],
        )
        .map_err(db_error)?;
    }
    let raw: String = tx
        .query_row("SELECT data FROM schedule WHERE id=1", [], |row| row.get(0))
        .map_err(db_error)?;
    if raw.len() > 4096 {
        return Err("Invalid saved schedule; database retained for recovery".into());
    }
    let mut saved: Saved = serde_json::from_str(&raw)
        .map_err(|_| "Invalid saved schedule; database retained for recovery")?;
    if let Some(config) = &saved.config {
        config.validate()?;
    }
    if saved.processed_through < 0 || Timestamp::from_second(saved.processed_through).is_err() {
        return Err("Invalid saved schedule cursor".into());
    }
    if let Some(value) = &saved.last_start_date {
        date(value)?;
    }
    if saved.config.is_some() {
        *running = false;
        saved.processed_through = saved.processed_through.max(Timestamp::now().as_second());
        tx.execute("UPDATE queue SET running=0 WHERE id=1", [])
            .map_err(db_error)?;
        tx.execute(
            "UPDATE schedule SET data=?1 WHERE id=1",
            [serde_json::to_string(&saved).map_err(json_error)?],
        )
        .map_err(db_error)?;
    }
    Ok(Runtime {
        saved,
        observed: None,
        error: None,
    })
}

pub(super) fn allows_dispatch(state: &State) -> bool {
    state.queue_running && state.schedule.error.is_none()
}

pub(super) fn tick_system(state: &mut State) {
    let now = Timestamp::now();
    if state.schedule.saved.config.is_none()
        || state
            .schedule
            .observed
            .as_ref()
            .is_some_and(|(previous, _)| *previous == now.as_second())
    {
        return;
    }
    tick(state, now, TimeZone::try_system().ok());
}

pub(super) fn manual_gate(state: &mut State, running: bool, now: i64) -> Result<()> {
    let mut saved = state.schedule.saved.clone();
    saved.processed_through = saved.processed_through.max(now);
    if let (Some(config), Some((_, zone))) = (&saved.config, &state.schedule.observed) {
        let today = Timestamp::from_second(now)
            .map_err(|_| "Invalid schedule clock")?
            .to_zoned(zone.clone())
            .date();
        for day in config.days(today, true) {
            if config
                .window(day, zone)
                .is_some_and(|(start, _)| start <= now)
            {
                remember_start(&mut saved.last_start_date, day);
            }
        }
    }
    write(state, running, saved)
}

fn remember_start(previous: &mut Option<String>, day: Date) {
    let value = day.to_string();
    if previous.as_ref().is_none_or(|old| *old < value) {
        *previous = Some(value);
    }
}

pub(super) fn tick(state: &mut State, now: Timestamp, zone: Option<TimeZone>) {
    if state.schedule.saved.config.is_none() {
        return;
    }
    let Some(zone) = zone else {
        state.schedule.error = Some("Local time zone unavailable; new starts are blocked".into());
        return;
    };
    if advance(state, now, zone).is_err() {
        state.schedule.error = Some("Could not save the schedule transition; new starts are blocked. Repair storage and retry".into());
    }
}

fn advance(state: &mut State, now: Timestamp, zone: TimeZone) -> Result<()> {
    let second = now.as_second();
    let Some((previous, previous_zone)) = state.schedule.observed.clone() else {
        state.schedule.observed = Some((second, zone));
        return Ok(());
    };
    let mut saved = state.schedule.saved.clone();
    if previous_zone != zone {
        saved.processed_through = saved.processed_through.max(second);
        write(state, false, saved)?;
        state.schedule.observed = Some((second, zone));
        return Ok(());
    }
    if second <= previous {
        return Ok(());
    }
    let config = saved.config.as_ref().expect("enabled schedule");
    let today = now.to_zoned(zone.clone()).date();
    let mut events = Vec::new();
    for day in config.days(today, true) {
        if let Some((start, stop)) = config.window(day, &zone) {
            for (at, running) in [(start, true), (stop, false)] {
                if at > saved.processed_through && at <= second {
                    events.push((at, running, day));
                }
            }
        }
    }
    events.sort_by_key(|event| event.0);
    let mut running = state.queue_running;
    for (at, start, day) in &events {
        if *start {
            let unused = saved
                .last_start_date
                .as_ref()
                .is_none_or(|old| *old < day.to_string());
            remember_start(&mut saved.last_start_date, *day);
            if unused && second - previous <= 90 && second - at <= 90 {
                running = true;
            }
        } else {
            running = false;
        }
    }
    if !events.is_empty() || state.schedule.error.is_some() {
        saved.processed_through = saved.processed_through.max(second);
        write(state, running, saved)?;
    }
    state.schedule.observed = Some((second, zone));
    Ok(())
}

impl Manager {
    pub fn set_schedule(&self, config: Option<Schedule>) -> Result<()> {
        self.set_schedule_at(config, Timestamp::now(), TimeZone::try_system().ok())
    }

    fn set_schedule_at(
        &self,
        config: Option<Schedule>,
        now: Timestamp,
        zone: Option<TimeZone>,
    ) -> Result<()> {
        if let Some(config) = &config {
            config.validate()?;
            let zone = zone.as_ref().ok_or("Local time zone unavailable")?;
            if let ScheduleTiming::Once { date: value } = &config.timing
                && config
                    .window(date(value)?, zone)
                    .is_none_or(|(start, _)| start <= now.as_second())
            {
                return Err("Choose a future start outside a daylight-saving gap".into());
            }
        }
        let mut state = self.state.lock().expect("state lock");
        let running = config.is_none() && state.queue_running;
        write(
            &mut state,
            running,
            Saved {
                config,
                processed_through: now.as_second(),
                last_start_date: None,
            },
        )?;
        state.schedule.observed = zone.map(|zone| (now.as_second(), zone));
        Ok(())
    }
}

pub(super) fn snapshot(state: &State) -> ScheduleState {
    let now = Timestamp::now();
    let zone = TimeZone::try_system().ok();
    let next_start = zone.as_ref().and_then(|zone| {
        let config = state.schedule.saved.config.as_ref()?;
        config
            .days(now.to_zoned(zone.clone()).date(), false)
            .into_iter()
            .filter_map(|day| {
                let (start, _) = config.window(day, zone)?;
                (start > now.as_second().max(state.schedule.saved.processed_through)
                    && state
                        .schedule
                        .saved
                        .last_start_date
                        .as_ref()
                        .is_none_or(|old| *old < day.to_string()))
                .then_some(start)
            })
            .min()
    });
    ScheduleState {
        config: state.schedule.saved.config.clone(),
        next_start,
        time_zone: zone
            .as_ref()
            .map(|zone| {
                zone.iana_name()
                    .map(str::to_owned)
                    .unwrap_or_else(|| now.to_zoned(zone.clone()).offset().to_string())
            })
            .unwrap_or_default(),
        error: state.schedule.error.clone(),
    }
}

#[cfg(test)]
#[path = "schedule_tests.rs"]
mod tests;
