import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIVE_PROVIDERS, createLiveSessionInput, meetingLink, updateLiveSessionInput, youtubeRef } from '@grand/contracts';

import { formatDateTime } from '../lib/format.js';
import { detailsByField, errorMessage, issuesByField } from '../lib/forms.js';
import { DURATIONS, PROVIDERS, durationLabel, getLiveOptions, liveKeys, scheduleLive, updateLiveSession } from '../lib/liveClasses.js';
import { toast } from '../lib/toast.js';
import { isoToZoned, localTimeZone, timeZoneLabel, zonedToIso } from '../lib/zonedTime.js';
import Button from './Button.jsx';
import Dialog from './Dialog.jsx';
import { FormAlert, SelectField, TextAreaField, TextField } from './Field.jsx';
import Icon from './Icon.jsx';
import { Block } from './Skeleton.jsx';
import styles from './LiveSchedule.module.scss';

const FIELDS = ['title', 'startsAt', 'durationMinutes', 'provider', 'streamRef', 'recordingRef', 'description'];

/** Tomorrow at the next full hour, on the viewer's clock: where a new class starts. */
function defaultStart() {
  const date = new Date(Date.now() + 24 * 3600_000);
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return isoToZoned(date.toISOString());
}

function initialValues(item) {
  const start = item ? isoToZoned(item.startsAt) : defaultStart();
  return {
    title: item?.title ?? '',
    description: item?.description ?? '',
    date: start.date,
    time: start.time,
    durationMinutes: String(item?.durationMinutes ?? 60),
    provider: item?.provider ?? '',
    streamRef: item?.streamRef ?? '',
    recordingRef: item?.recordingRef ?? '',
  };
}

/** A stream reference checked for its provider, as the API will: a YouTube video, or an https meeting address. */
function checkStreamRef(provider, value) {
  const text = value.trim();
  if (provider === 'livekit') return { value: null };
  if (provider === 'link') {
    const parsed = meetingLink.safeParse(text);
    return parsed.success ? { value: parsed.data } : { error: 'Add the meeting’s https:// address' };
  }
  if (!text) return { value: null };
  const parsed = youtubeRef.safeParse(text);
  return parsed.success ? { value: parsed.data } : { error: parsed.error.issues[0]?.message ?? "That doesn't look like a YouTube video or its address" };
}

/**
 * Scheduling a live class (`item` null) or changing one, in a drawer: its title and description,
 * the date and time on the viewer's own clock (sent as an instant with their time zone's offset),
 * how long, and where the video comes from (the providers this server offers): in the browser,
 * a YouTube Live stream, or a meeting link. Changing one also takes a replay to show afterwards.
 * `focus` ('recording') starts on that field.
 */
export default function LiveClassForm({ open, onClose, slug, courseSlug, item = null, focus = null, onSaved }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => initialValues(item));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const refs = useRef(Object.fromEntries(FIELDS.map((field) => [field, { current: null }]))).current;
  const editing = Boolean(item);
  const zone = localTimeZone();

  const options = useQuery({
    queryKey: liveKeys.options(slug),
    queryFn: ({ signal }) => getLiveOptions(slug, signal),
    staleTime: 10 * 60_000,
    enabled: open && !editing,
  });
  const providers = editing ? [item.provider] : LIVE_PROVIDERS.filter((provider) => options.data?.providers?.includes(provider));

  // Each time it opens: the class as it is then (or a fresh one). Not while it's open, so a class
  // refreshed in the background doesn't undo what's being typed.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setValues(initialValues(item));
      setErrors({});
    }
    wasOpen.current = open;
  }, [open, item]);

  // The first provider offered, once known.
  const firstProvider = providers[0];
  useEffect(() => {
    if (!editing && !values.provider && firstProvider) setValues((current) => ({ ...current, provider: firstProvider }));
  }, [editing, values.provider, firstProvider]);

  useEffect(() => {
    if (open && focus === 'recording') requestAnimationFrame(() => refs.recordingRef.current?.focus());
  }, [open, focus, refs]);

  const set = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field] || (field === 'date' || field === 'time' ? errors.startsAt : false)) {
      setErrors((current) => ({ ...current, [field === 'date' || field === 'time' ? 'startsAt' : field]: undefined }));
    }
  };

  const fail = (found) => {
    setErrors(found);
    const first = FIELDS.find((field) => found[field]);
    refs[first]?.current?.focus();
  };

  /** The API's input from the form, checked; or null after showing what's wrong. */
  const check = () => {
    const startsAt = zonedToIso(values.date, values.time, zone);
    const base = { title: values.title, description: values.description, startsAt: startsAt ?? '', durationMinutes: Number(values.durationMinutes) };
    const mine = {};
    if (!startsAt) mine.startsAt = 'Choose a date and time';
    else if (!editing && Date.parse(startsAt) < Date.now() - 60_000) mine.startsAt = 'Choose a time that hasn’t passed';

    if (!editing) {
      const result = createLiveSessionInput.safeParse({ ...base, provider: values.provider, streamRef: values.streamRef.trim() || null });
      if (!values.provider) mine.provider = 'Choose where the video comes from';
      const found = { ...issuesByField(result), ...mine };
      if (!result.success || Object.values(found).some(Boolean)) {
        fail(found);
        return null;
      }
      return result.data;
    }

    // Changing a class: only what changed.
    const found = { ...mine };
    const stream = checkStreamRef(item.provider, values.streamRef);
    if (stream.error) found.streamRef = stream.error;
    let recording = null;
    if (values.recordingRef.trim()) {
      const parsed = youtubeRef.safeParse(values.recordingRef);
      if (parsed.success) recording = parsed.data;
      else found.recordingRef = parsed.error.issues[0]?.message;
    }
    if (Object.values(found).some(Boolean)) {
      fail(found);
      return null;
    }
    const changes = {};
    if (base.title.trim() !== item.title) changes.title = base.title;
    if (base.description.trim() !== item.description) changes.description = base.description;
    if (Date.parse(startsAt) !== Date.parse(item.startsAt)) changes.startsAt = startsAt;
    if (base.durationMinutes !== item.durationMinutes) changes.durationMinutes = base.durationMinutes;
    if (item.provider !== 'livekit' && stream.value !== item.streamRef) changes.streamRef = stream.value;
    if (recording !== item.recordingRef) changes.recordingRef = recording;
    if (!Object.keys(changes).length) return {};
    const result = updateLiveSessionInput.safeParse(changes);
    if (!result.success) {
      fail(issuesByField(result));
      return null;
    }
    return result.data;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = check();
    if (!input) return;
    if (editing && !Object.keys(input).length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const saved = editing ? await updateLiveSession(slug, courseSlug, item.id, input) : await scheduleLive(slug, courseSlug, input);
      queryClient.setQueryData(liveKeys.session(slug, courseSlug, saved.id), saved);
      queryClient.invalidateQueries({ queryKey: liveKeys.course(slug, courseSlug) });
      queryClient.invalidateQueries({ queryKey: ['liveSchedule', slug] });
      toast(editing ? 'Class updated' : `Class scheduled for ${formatDateTime(saved.startsAt)}`);
      onSaved?.(saved);
      onClose();
    } catch (error) {
      const found = detailsByField(error);
      if (!FIELDS.some((field) => found[field])) found[''] = errorMessage(error);
      fail(found);
    } finally {
      setBusy(false);
    }
  };

  const provider = values.provider;
  const loadingOptions = !editing && options.isPending;

  return (
    <Dialog
      open={open}
      variant="drawer"
      title={editing ? 'Edit live class' : 'Schedule a live class'}
      description={editing ? item.title : 'Students enrolled in the course are told when it’s scheduled, reminded 15 minutes before, and told when it starts.'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} icon={editing ? 'check' : 'calendar'} busy={busy}>
            {editing ? 'Save changes' : 'Schedule class'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <FormAlert>{errors['']}</FormAlert>
        <TextField
          ref={refs.title}
          label="Title"
          placeholder="Live Q&A: scales and arpeggios"
          maxLength={120}
          autoComplete="off"
          value={values.title}
          error={errors.title}
          onChange={(event) => set('title', event.target.value)}
        />

        <fieldset className={styles.when} aria-describedby={`${formId}-zone`}>
          <legend className={styles.legend}>When</legend>
          <div className={styles.whenRow}>
            <TextField
              ref={refs.startsAt}
              label="Date"
              type="date"
              value={values.date}
              error={errors.startsAt}
              onChange={(event) => set('date', event.target.value)}
              className={styles.date}
            />
            <TextField label="Start time" type="time" step={300} value={values.time} onChange={(event) => set('time', event.target.value)} />
            <SelectField
              ref={refs.durationMinutes}
              label="Length"
              value={values.durationMinutes}
              error={errors.durationMinutes}
              options={[...new Set([...DURATIONS, Number(values.durationMinutes)])]
                .sort((a, b) => a - b)
                .map((minutes) => ({ value: String(minutes), label: durationLabel(minutes) }))}
              onChange={(event) => set('durationMinutes', event.target.value)}
            />
          </div>
          <p id={`${formId}-zone`} className={styles.hint}>
            <Icon name="globe" size={14} />
            In your time zone: {timeZoneLabel(zone, Date.parse(zonedToIso(values.date, values.time, zone) ?? '') || Date.now())}. Everyone sees it in their own.
          </p>
        </fieldset>

        {editing ? (
          <p className={styles.providerFixed}>
            <Icon name={PROVIDERS[item.provider].icon} size={18} />
            <span>
              Video: <strong>{PROVIDERS[item.provider].label}</strong>
            </span>
          </p>
        ) : (
          <fieldset className={styles.providers} aria-describedby={errors.provider ? `${formId}-provider-error` : undefined}>
            <legend className={styles.legend}>Video</legend>
            {loadingOptions ? (
              <Block height="4.5rem" radius="var(--radius-md)" />
            ) : options.isError ? (
              <p className={styles.fieldError}>
                <Icon name="alert" size={15} />
                {errorMessage(options.error)}
              </p>
            ) : (
              providers.map((value, index) => (
                <label key={value} className={styles.provider} htmlFor={`${formId}-${value}`}>
                  <input
                    id={`${formId}-${value}`}
                    ref={index === 0 ? refs.provider : undefined}
                    type="radio"
                    name="provider"
                    value={value}
                    checked={provider === value}
                    onChange={() => set('provider', value)}
                  />
                  <span className={styles.providerIcon} aria-hidden="true">
                    <Icon name={PROVIDERS[value].icon} size={20} />
                  </span>
                  <span className={styles.providerText}>
                    <span className={styles.providerLabel}>{PROVIDERS[value].label}</span>
                    <span className={styles.providerHint}>{PROVIDERS[value].hint}</span>
                  </span>
                </label>
              ))
            )}
            {errors.provider && (
              <p id={`${formId}-provider-error`} className={styles.fieldError}>
                <Icon name="alert" size={15} />
                {errors.provider}
              </p>
            )}
          </fieldset>
        )}

        {provider === 'youtube' && (
          <TextField
            ref={refs.streamRef}
            label="YouTube stream address"
            placeholder="https://youtube.com/live/…"
            hint="Optional for now: add it here or on the class page before you go live."
            inputMode="url"
            autoComplete="off"
            value={values.streamRef}
            error={errors.streamRef}
            onChange={(event) => set('streamRef', event.target.value)}
          />
        )}
        {provider === 'link' && (
          <TextField
            ref={refs.streamRef}
            label="Meeting link"
            placeholder="https://meet.example.com/…"
            hint="Students see it 10 minutes before the start, and open it in a new tab."
            type="url"
            inputMode="url"
            autoComplete="off"
            value={values.streamRef}
            error={errors.streamRef}
            onChange={(event) => set('streamRef', event.target.value)}
          />
        )}

        <TextAreaField
          ref={refs.description}
          label="Description (optional)"
          placeholder="What you'll cover, and anything to bring or prepare."
          rows={4}
          maxLength={5000}
          value={values.description}
          error={errors.description}
          onChange={(event) => set('description', event.target.value)}
        />

        {editing && (
          <TextField
            ref={refs.recordingRef}
            label="Replay (a YouTube video)"
            placeholder="https://youtube.com/watch?v=…"
            hint={item.provider === 'youtube' ? 'Leave it empty to replay the stream itself.' : 'Shown on the class page once it has ended.'}
            inputMode="url"
            autoComplete="off"
            value={values.recordingRef}
            error={errors.recordingRef}
            onChange={(event) => set('recordingRef', event.target.value)}
          />
        )}
      </form>
    </Dialog>
  );
}
