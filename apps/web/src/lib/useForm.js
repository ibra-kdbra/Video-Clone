import { useState } from 'react';

import { detailsByField, errorMessage, issuesByField } from './forms.js';

/**
 * State for a small form checked by one of the API's own zod schemas (from @grand/contracts), so
 * the page and the server agree on every rule and message. `fields` lists the inputs in page
 * order, which is the order focus goes to the first one that needs attention.
 *
 * - `bind(field)` gives an input its value, change handler, error and ref; `set(field, value)` and
 *   `update({ field: value, … })` change values from code.
 * - `validate()` returns the parsed data, or null after showing what's wrong.
 * - `fail(error, fieldFor)` shows a failed request's errors: on the fields the server named, on
 *   the field `fieldFor[error.code]` names, or else on the form as a whole (key "").
 */
export function useForm(schema, initial, fields) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [refs] = useState(() => Object.fromEntries(fields.map((field) => [field, { current: null }])));

  const focusFirst = (found) => refs[fields.find((field) => found[field])]?.current?.focus();

  const update = (patch) => {
    const next = { ...values, ...patch };
    setValues(next);
    // Once a field has been flagged, it's checked again as it's corrected, so the message goes
    // away as soon as it's right (and not before someone has tried to submit).
    const flagged = Object.keys(patch).filter((field) => errors[field]);
    if (flagged.length === 0) return;
    const found = issuesByField(schema.safeParse(next));
    setErrors((current) => ({ ...current, ...Object.fromEntries(flagged.map((field) => [field, found[field]])) }));
  };
  const set = (field, value) => update({ [field]: value });

  const validate = () => {
    const result = schema.safeParse(values);
    const found = issuesByField(result);
    setErrors(found);
    if (result.success) return result.data;
    focusFirst(found);
    return null;
  };

  const fail = (error, fieldFor = {}) => {
    const found = detailsByField(error);
    const field = fieldFor[error?.code];
    if (field) found[field] ??= errorMessage(error);
    if (!found[''] && !fields.some((name) => found[name])) found[''] = errorMessage(error);
    setErrors(found);
    focusFirst(found);
  };

  const bind = (field) => ({
    ref: refs[field],
    name: field,
    value: values[field],
    error: errors[field],
    onChange: (event) => set(field, event.target.value),
  });

  return { values, errors, refs, bind, set, update, validate, fail };
}
