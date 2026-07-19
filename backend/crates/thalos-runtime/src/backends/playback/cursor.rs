use std::time::Duration;

/// Estado del cursor de reproducción.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PlaybackState {
    Playing,
    Paused,
    Stopped,
}

/// Control de tiempo para reproducción de traces.
///
/// Maneja posición, velocidad, seek, step y scrub independientemente
/// del backend. El ReplayBackend consulta `position()` para saber
/// en qué tiempo debe interpolar.
#[derive(Debug, Clone)]
pub struct PlaybackCursor {
    position: Duration,
    speed: f64,
    total_duration: Duration,
    state: PlaybackState,
}

impl PlaybackCursor {
    pub fn new(total_duration: Duration) -> Self {
        Self {
            position: Duration::ZERO,
            speed: 1.0,
            total_duration,
            state: PlaybackState::Stopped,
        }
    }

    /// Avanzar el cursor `dt` segundos (tiempo real), ajustado por speed.
    ///
    /// Returns la nueva posición.
    pub fn advance(&mut self, dt: f64) -> Duration {
        if self.state != PlaybackState::Playing {
            return self.position;
        }

        let delta = dt * self.speed;
        let new_pos = self.position.as_secs_f64() + delta;

        if new_pos >= self.total_duration.as_secs_f64() {
            self.position = self.total_duration;
            self.state = PlaybackState::Stopped;
        } else {
            self.position = Duration::from_secs_f64(new_pos.max(0.0));
        }

        self.position
    }

    /// Ir a una posición específica.
    pub fn seek(&mut self, t: Duration) {
        self.position = if t > self.total_duration {
            self.total_duration
        } else {
            t
        };
    }

    /// Ir a una posición por fracción (0.0 a 1.0).
    pub fn seek_progress(&mut self, progress: f64) {
        let t = self.total_duration.as_secs_f64() * progress.clamp(0.0, 1.0);
        self.position = Duration::from_secs_f64(t);
    }

    /// Fijar velocidad de reproducción.
    pub fn set_speed(&mut self, speed: f64) {
        self.speed = speed.max(0.0);
    }

    pub fn speed(&self) -> f64 {
        self.speed
    }

    /// Pausar la reproducción.
    pub fn pause(&mut self) {
        if self.state == PlaybackState::Playing {
            self.state = PlaybackState::Paused;
        }
    }

    /// Reanudar la reproducción.
    pub fn resume(&mut self) {
        if self.state == PlaybackState::Paused || self.state == PlaybackState::Stopped {
            self.state = PlaybackState::Playing;
            if self.position >= self.total_duration {
                self.position = Duration::ZERO;
            }
        }
    }

    /// Detener y volver al inicio.
    pub fn stop(&mut self) {
        self.state = PlaybackState::Stopped;
        self.position = Duration::ZERO;
    }

    /// Avanzar/retroceder un sample (step).
    /// Retorna la nueva posición.
    pub fn step(&mut self, sample_times: &[Duration], forward: bool) -> Duration {
        if sample_times.is_empty() {
            return self.position;
        }

        let current = self.position;
        let new_pos = if forward {
            // Siguiente sample después de la posición actual
            sample_times
                .iter()
                .find(|&&t| t > current)
                .copied()
                .unwrap_or(*sample_times.last().unwrap())
        } else {
            // Sample anterior antes de la posición actual
            sample_times
                .iter()
                .rev()
                .find(|&&t| t < current)
                .copied()
                .unwrap_or(sample_times[0])
        };

        self.position = new_pos;
        self.position
    }

    /// Posición actual.
    pub fn position(&self) -> Duration {
        self.position
    }

    /// Duración total.
    pub fn total_duration(&self) -> Duration {
        self.total_duration
    }

    /// Progreso 0.0 a 1.0.
    pub fn progress(&self) -> f64 {
        if self.total_duration.is_zero() {
            return 1.0;
        }
        (self.position.as_secs_f64() / self.total_duration.as_secs_f64()).clamp(0.0, 1.0)
    }

    /// Estado actual.
    pub fn state(&self) -> PlaybackState {
        self.state
    }

    /// ¿Está reproduciendo?
    pub fn is_playing(&self) -> bool {
        self.state == PlaybackState::Playing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cursor() -> PlaybackCursor {
        PlaybackCursor::new(Duration::from_secs_f64(10.0))
    }

    #[test]
    fn initial_state() {
        let c = cursor();
        assert_eq!(c.position(), Duration::ZERO);
        assert_eq!(c.speed(), 1.0);
        assert_eq!(c.state(), PlaybackState::Stopped);
        assert_eq!(c.progress(), 0.0);
    }

    #[test]
    fn advance_when_stopped_does_nothing() {
        let mut c = cursor();
        c.advance(1.0);
        assert_eq!(c.position(), Duration::ZERO);
    }

    #[test]
    fn resume_then_advance() {
        let mut c = cursor();
        c.resume();
        c.advance(2.0);
        assert!((c.position().as_secs_f64() - 2.0).abs() < 1e-6);
        assert_eq!(c.state(), PlaybackState::Playing);
    }

    #[test]
    fn speed_affects_advance() {
        let mut c = cursor();
        c.set_speed(2.0);
        c.resume();
        c.advance(1.0); // debería avanzar 2 segundos
        assert!((c.position().as_secs_f64() - 2.0).abs() < 1e-6);
    }

    #[test]
    fn advance_past_end_stops() {
        let mut c = cursor();
        c.resume();
        c.advance(20.0);
        assert_eq!(c.position(), c.total_duration());
        assert_eq!(c.state(), PlaybackState::Stopped);
    }

    #[test]
    fn seek_to_position() {
        let mut c = cursor();
        c.seek(Duration::from_secs_f64(3.0));
        assert!((c.position().as_secs_f64() - 3.0).abs() < 1e-6);
    }

    #[test]
    fn seek_past_end_clamps() {
        let mut c = cursor();
        c.seek(Duration::from_secs_f64(100.0));
        assert_eq!(c.position(), c.total_duration());
    }

    #[test]
    fn seek_progress() {
        let mut c = cursor();
        c.seek_progress(0.5);
        assert!((c.position().as_secs_f64() - 5.0).abs() < 1e-6);
    }

    #[test]
    fn pause_and_resume() {
        let mut c = cursor();
        c.resume();
        c.advance(2.0);
        c.pause();
        assert_eq!(c.state(), PlaybackState::Paused);
        c.advance(1.0); // no avanza mientras está pausado
        assert!((c.position().as_secs_f64() - 2.0).abs() < 1e-6);
        c.resume();
        c.advance(1.0);
        assert!((c.position().as_secs_f64() - 3.0).abs() < 1e-6);
    }

    #[test]
    fn stop_resets_position() {
        let mut c = cursor();
        c.resume();
        c.advance(3.0);
        c.stop();
        assert_eq!(c.position(), Duration::ZERO);
        assert_eq!(c.state(), PlaybackState::Stopped);
    }

    #[test]
    fn step_forward_and_backward() {
        let mut c = cursor();
        let times: Vec<Duration> = vec![0.0, 1.0, 2.0, 3.0, 4.0]
            .into_iter()
            .map(Duration::from_secs_f64)
            .collect();

        c.seek(times[1]);
        let pos = c.step(&times, true);
        assert!((pos.as_secs_f64() - 2.0).abs() < 1e-6);

        let pos = c.step(&times, false);
        assert!((pos.as_secs_f64() - 1.0).abs() < 1e-6);
    }

    #[test]
    fn progress_after_seek() {
        let mut c = cursor();
        c.seek(Duration::from_secs_f64(2.5));
        assert!((c.progress() - 0.25).abs() < 1e-6);
    }
}
