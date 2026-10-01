import { Link } from 'react-router-dom';

import { lessonPath } from '../lib/courses.js';
import NotFound from '../pages/NotFound.jsx';
import { EmptyState, ErrorState } from './States.jsx';

/** Why submissions can't be shown: not an assignment (or no such submission), not an editor, or a failure. */
export default function SubmissionsProblem({ error, slug, courseSlug, lessonId, onRetry, what = 'submissions' }) {
  if (error?.status === 404)
    return (
      <NotFound title="Not found">
        There are no {what} at this address. <Link to={lessonPath(slug, courseSlug, lessonId)}>Back to the lesson</Link>.
      </NotFound>
    );
  if (error?.status === 403)
    return (
      <div className="page">
        <EmptyState icon="lock" title="Only the course's editors can see submissions" titleAs="h1">
          <Link to={lessonPath(slug, courseSlug, lessonId)}>Back to the lesson</Link>
        </EmptyState>
      </div>
    );
  return (
    <div className="page">
      <ErrorState titleAs="h1" title={`Couldn't load the ${what}`} error={error} onRetry={onRetry} />
    </div>
  );
}
