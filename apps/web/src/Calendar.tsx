import { useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { dateLabel } from './time';
import { Icon, Modal } from './components';
export function Calendar({
  value,
  today,
  onChoose,
  onClose,
}: {
  value: string;
  today: string;
  onChoose: (date: string) => void;
  onClose: () => void;
}) {
  const selected = Temporal.PlainDate.from(value);
  const [cursor, setCursor] = useState(selected.with({ day: 1 })),
    [level, setLevel] = useState<'days' | 'months' | 'years'>('days');
  const [base, setBase] = useState(Math.floor(selected.year / 12) * 12);
  const title =
    level === 'years'
      ? `${base} – ${Math.min(base + 11, 9999)}`
      : level === 'months'
        ? String(cursor.year)
        : dateLabel(cursor.toString(), { month: 'long', year: 'numeric' });
  function step(direction: number) {
    if (level === 'years')
      setBase((n) => Math.max(1, Math.min(9988, n + direction * 12)));
    else {
      try {
        const next = cursor.add(
          level === 'months' ? { years: direction } : { months: direction },
        );
        if (next.year >= 1 && next.year <= 9999) setCursor(next);
      } catch {
        /* Outside supported calendar range. */
      }
    }
  }
  return (
    <Modal title="Choose a date" onClose={onClose}>
      <div className="calendar">
        <div className="calendar-heading">
          <button
            className="icon-button"
            aria-label="Previous calendar page"
            onClick={() => step(-1)}
          >
            <Icon name="back" />
          </button>
          <button
            className="calendar-title"
            onClick={() => setLevel(level === 'days' ? 'months' : 'years')}
          >
            {title}
            <span aria-hidden="true"> ▾</span>
          </button>
          <button
            className="icon-button"
            aria-label="Next calendar page"
            onClick={() => step(1)}
          >
            <Icon name="next" />
          </button>
        </div>
        {level === 'years' ? (
          <div className="tile-grid">
            {Array.from({ length: 12 }, (_, i) => base + i)
              .filter((y) => y > 0 && y <= 9999)
              .map((year) => (
                <button
                  key={year}
                  className={year === selected.year ? 'chosen' : ''}
                  onClick={() => {
                    setCursor(cursor.with({ year }));
                    setLevel('months');
                  }}
                >
                  {year}
                </button>
              ))}
          </div>
        ) : level === 'months' ? (
          <div className="tile-grid">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <button
                key={month}
                className={
                  month === selected.month && cursor.year === selected.year
                    ? 'chosen'
                    : ''
                }
                onClick={() => {
                  setCursor(cursor.with({ month }));
                  setLevel('days');
                }}
              >
                {dateLabel(cursor.with({ month }).toString(), {
                  month: 'long',
                })}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="weekdays" aria-hidden="true">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="day-grid">
              {Array.from({ length: cursor.dayOfWeek - 1 }, (_, i) => (
                <span key={`blank-${i}`} />
              ))}
              {Array.from({ length: cursor.daysInMonth }, (_, i) => i + 1).map(
                (day) => {
                  const date = cursor.with({ day }).toString();
                  return (
                    <button
                      key={day}
                      aria-label={dateLabel(date)}
                      aria-pressed={date === value}
                      className={`${date === value ? 'chosen' : ''} ${date === today ? 'is-today' : ''}`}
                      onClick={() => onChoose(date)}
                    >
                      {day}
                    </button>
                  );
                },
              )}
            </div>
          </>
        )}
        <button className="text-button wide" onClick={() => onChoose(today)}>
          Go to today
        </button>
        <p className="fine muted">Tap the heading to choose a month or year.</p>
      </div>
    </Modal>
  );
}
