/**
 * The kinds of notification, as people see them: a name for the settings page, what it's about,
 * and an icon for the list. (NOTIFICATION_TYPES in @grand/contracts lists the same kinds.)
 */
export const NOTIFICATION_KINDS = {
  'course.published': { label: 'New courses in your schools', hint: 'When a school you belong to publishes a course.', icon: 'layers' },
  'lesson.published': { label: 'New lessons in your courses', hint: "When a course you're enrolled in gets a new lesson.", icon: 'film' },
  'assignment.submitted': { label: 'Work handed in to you', hint: 'When a student hands in an assignment in a course you made.', icon: 'assignment' },
  'assignment.graded': { label: 'Grades and feedback', hint: 'When your work is graded, or returned to you for changes.', icon: 'checkCircle' },
  'video.processed': { label: 'Your video uploads', hint: "When a video you uploaded is ready to watch, or couldn't be processed.", icon: 'upload' },
  'discussion.reply': { label: 'Replies to you', hint: "When someone replies to a thread or comment you wrote, or one you've replied to.", icon: 'reply' },
  'discussion.posted': {
    label: 'New threads in courses you teach',
    hint: 'When a student starts a thread or comments on a lesson in a course you teach.',
    icon: 'message',
  },
  'discussion.reported': { label: 'Reported posts', hint: 'When someone reports a post in a course you moderate.', icon: 'flag' },
  'live.scheduled': { label: 'Live classes scheduled', hint: "When a live class is scheduled in a course you're enrolled in.", icon: 'calendar' },
  'live.reminder': { label: 'Live class reminders', hint: 'Fifteen minutes before a live class you can join starts.', icon: 'clock' },
  'live.started': { label: 'Live classes starting', hint: "When a live class in a course you're enrolled in goes live.", icon: 'broadcast' },
};

export const iconFor = (type) => NOTIFICATION_KINDS[type]?.icon ?? 'bell';
