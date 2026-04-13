import { useState } from 'react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateToIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToLocal(isoStr) {
  const [y, m, d] = isoStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getUpcomingDays(startDateStr, count = 28) {
  const base = isoToLocal(startDateStr);
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push(d);
  }
  return days;
}

// Returns [{dt, amount, isPartial}] — one entry per hourly payment
function calcHourlyPayTimes(isoDate, workStartTime, hours) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const [hh, mm] = workStartTime.split(':').map(Number);
  const times = [];
  const wholeHours = Math.floor(hours);
  const remainder  = Math.round((hours - wholeHours) * 100) / 100;

  for (let h = 1; h <= wholeHours; h++) {
    const dt = new Date(y, mo - 1, d, hh, mm, 0);
    dt.setMinutes(dt.getMinutes() + h * 60);
    times.push({ dt, amount: 1, isPartial: false });
  }
  if (remainder >= 0.01) {
    const dt = new Date(y, mo - 1, d, hh, mm, 0);
    dt.setMinutes(dt.getMinutes() + Math.round(hours * 60));
    times.push({ dt, amount: remainder, isPartial: true });
  }
  return times;
}

function fmtTime(dt) {
  return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDisplayDate(isoStr) {
  return isoToLocal(isoStr).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// Compute +1 hour from a HH:MM string for the note
function plusOneHour(hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const dt = new Date(2000, 0, 1, hh, mm + 60);
  return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function TempWorkerForm({ onClose }) {
  const todayStr = dateToIso(new Date());

  const [form, setForm] = useState({
    workerName: '',
    recipientAddress: '',
    hourlyRate: '',
    asset: 'USDC',
    workStartTime: '09:00',
    startDate: todayStr,
  });

  // dateStr → hours string — presence in map means day is selected
  const [dayHours, setDayHours] = useState({});
  const [error, setError]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);
  const [scheduledBills, setScheduledBills] = useState([]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const sortedDates = Object.keys(dayHours).sort();
  const upcomingDays = getUpcomingDays(form.startDate, 28);

  const toggleDate = (iso) => {
    setDayHours(prev => {
      const next = { ...prev };
      if (iso in next) delete next[iso];
      else next[iso] = '4'; // sensible default
      return next;
    });
  };

  const setDayHrs = (iso, val) =>
    setDayHours(prev => ({ ...prev, [iso]: val }));

  const rate = parseFloat(form.hourlyRate);

  // Total payments across all days; each whole hour = 1 payment, partial = 1 extra
  const totalPayments = sortedDates.reduce((sum, d) => {
    const h = parseFloat(dayHours[d]);
    if (isNaN(h) || h <= 0) return sum;
    return sum + Math.floor(h) + (h % 1 >= 0.01 ? 1 : 0);
  }, 0);

  const totalAmount = !isNaN(rate) && rate > 0
    ? sortedDates.reduce((sum, d) => {
        const h = parseFloat(dayHours[d]);
        return sum + (isNaN(h) || h <= 0 ? 0 : rate * h);
      }, 0)
    : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.workerName.trim())
      return setError('Worker name is required.');
    if (!form.recipientAddress.trim() || !form.recipientAddress.startsWith('G'))
      return setError('Valid Stellar address required (starts with G).');
    if (!form.hourlyRate || isNaN(rate) || rate <= 0)
      return setError('Hourly rate must be greater than 0.');
    if (sortedDates.length === 0)
      return setError('Select at least one working day.');
    if (sortedDates.some(d => { const h = parseFloat(dayHours[d]); return isNaN(h) || h <= 0; }))
      return setError('Each selected day must have a valid number of hours (> 0).');

    setSubmitting(true);
    try {
      const workDays = sortedDates.map(date => ({
        date,
        hours: parseFloat(dayHours[date]),
      }));

      const res = await fetch('/api/worker-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerName: form.workerName.trim(),
          workerAddress: form.recipientAddress.trim(),
          hourlyRate: form.hourlyRate,
          asset: form.asset,
          workStartTime: form.workStartTime,
          workDays,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.errors?.join(', ') || data.error || 'Failed to create schedule');
      }

      setScheduledBills(
        data.schedule.payments.map(p => ({
          label:   p.label,
          dateStr: p.date,
          payTime: fmtTime(new Date(p.payAt)),
          amount:  parseFloat(p.amount).toFixed(2),
        }))
      );
      setDone(true);
    } catch (err) {
      setError(err.message || 'Server error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const todayMidnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

  /* ── Done screen ─────────────────────────────────────────────── */
  if (done) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2>👷 Payments Scheduled</h2>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
          <div className="tw-done">
            <div className="tw-done-icon">✅</div>
            <p>
              <strong>{scheduledBills.length} payment{scheduledBills.length !== 1 ? 's' : ''}</strong>{' '}
              scheduled for <strong>{form.workerName}</strong>.
            </p>
            <p className="tw-done-sub">
              {form.hourlyRate} {form.asset}/hr · {totalAmount.toFixed(2)} {form.asset} total
            </p>
            <div className="tw-done-list">
              {scheduledBills.map((b, i) => (
                <div key={i} className="tw-done-row">
                  <span className="tw-done-day">{b.label}</span>
                  <span className="tw-done-date">{formatDisplayDate(b.dateStr)}</span>
                  <span className="tw-done-time">at {b.payTime}</span>
                  <span className="tw-done-amt">{b.amount} {form.asset}</span>
                </div>
              ))}
            </div>
            <button className="btn-primary" style={{ marginTop: '1.25rem', width: '100%' }} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Form ────────────────────────────────────────────────────── */
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tw-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>👷 Temp Worker Pay Scheduler</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Worker Name</label>
            <input
              placeholder="e.g. John Smith"
              value={form.workerName}
              onChange={e => set('workerName', e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Worker's Stellar Address</label>
            <input
              placeholder="G..."
              value={form.recipientAddress}
              onChange={e => set('recipientAddress', e.target.value)}
              required
              maxLength={56}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Hourly Rate</label>
              <input
                type="number"
                min="0.01"
                step="any"
                placeholder="e.g. 5"
                value={form.hourlyRate}
                onChange={e => set('hourlyRate', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Asset</label>
              <select value={form.asset} onChange={e => set('asset', e.target.value)}>
                <option value="USDC">USDC</option>
                <option value="XLM">XLM</option>
              </select>
            </div>
            <div className="form-group">
              <label>Shift Start Time</label>
              <input
                type="time"
                value={form.workStartTime}
                onChange={e => set('workStartTime', e.target.value)}
                required
              />
            </div>
          </div>

          {form.workStartTime && (
            <div className="tw-pay-time-note">
              ⏰ One payment per hour worked — first payment at{' '}
              <strong>{plusOneHour(form.workStartTime)}</strong>{' '}
              (shift start {form.workStartTime} + 1h). Each day can have a different number of hours.
            </div>
          )}

          {totalPayments > 0 && !isNaN(rate) && rate > 0 && (
            <div className="tw-summary">
              <span>💳 {totalPayments} payment{totalPayments !== 1 ? 's' : ''}</span>
              <span>🗓 {sortedDates.length} day{sortedDates.length !== 1 ? 's' : ''}</span>
              <span>🧾 Total: <strong>{totalAmount.toFixed(2)} {form.asset}</strong></span>
            </div>
          )}

          {/* Day picker */}
          <div className="form-group">
            <div className="tw-day-header">
              <label>Select Working Days</label>
              <div className="tw-start-row">
                <span>From</span>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={e => { set('startDate', e.target.value); setDayHours({}); }}
                  style={{ maxWidth: '150px' }}
                />
                {sortedDates.length > 0 && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setDayHours({})}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="tw-day-grid">
              {upcomingDays.map(day => {
                const iso = dateToIso(day);
                const isSelected = iso in dayHours;
                const isWeekend  = day.getDay() === 0 || day.getDay() === 6;
                const isPast     = day < todayMidnight;
                return (
                  <button
                    key={iso}
                    type="button"
                    className={`tw-day-btn${isSelected ? ' selected' : ''}${isWeekend ? ' weekend' : ''}${isPast ? ' past' : ''}`}
                    onClick={() => !isPast && toggleDate(iso)}
                    disabled={isPast}
                    title={iso}
                  >
                    <span className="tw-day-name">{DAY_NAMES[day.getDay()]}</span>
                    <span className="tw-day-num">{day.getDate()}</span>
                    <span className="tw-day-month">{day.toLocaleString('en-US', { month: 'short' })}</span>
                    {isSelected && dayHours[iso] && (
                      <span className="tw-day-hrs">{dayHours[iso]}h</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Per-day hours config */}
          {sortedDates.length > 0 && (
            <div className="tw-selected-list">
              {sortedDates.map((d, i) => {
                const h = parseFloat(dayHours[d]);
                const times = (!isNaN(h) && h > 0 && form.workStartTime)
                  ? calcHourlyPayTimes(d, form.workStartTime, h)
                  : [];
                return (
                  <div key={d} className="tw-day-config">
                    <div className="tw-day-config-header">
                      <span className="tw-chip-day">Day {i + 1}</span>
                      <span className="tw-chip-date">{formatDisplayDate(d)}</span>
                      <div className="tw-hours-input-row">
                        <input
                          type="number"
                          className="tw-hours-input"
                          min="0.5"
                          max="24"
                          step="0.5"
                          value={dayHours[d]}
                          onChange={e => setDayHrs(d, e.target.value)}
                          placeholder="hrs"
                        />
                        <span className="tw-hours-label">hrs</span>
                        {!isNaN(rate) && rate > 0 && !isNaN(h) && h > 0 && (
                          <span className="tw-chip-amt">{(rate * h).toFixed(2)} {form.asset}</span>
                        )}
                      </div>
                      <button type="button" className="tw-remove-day" onClick={() => toggleDate(d)}>✕</button>
                    </div>
                    {times.length > 0 && (
                      <div className="tw-pay-schedule">
                        {times.map((t, ti) => (
                          <span key={ti} className="tw-pay-slot">
                            {fmtTime(t.dt)}
                            {t.isPartial
                              ? ` (${(!isNaN(rate) ? (rate * t.amount).toFixed(2) : '?')})`
                              : (!isNaN(rate) ? ` (${rate.toFixed(2)})` : '')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          {sortedDates.length === 0 && !error && (
            <div className="tw-hint">👆 Select at least one working day from the calendar above.</div>
          )}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || sortedDates.length === 0}
            >
              {submitting
                ? `⟳ Scheduling...`
                : sortedDates.length === 0
                  ? `⚡ Schedule Payments`
                  : `⚡ Schedule ${totalPayments} Payment${totalPayments !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
