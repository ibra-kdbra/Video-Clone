import { lazy, Suspense, useId } from 'react';
import { m } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { DEMO, loadDemo, loadedDemo } from '../lib/demo.js';
import { authPath } from '../lib/paths.js';
import Backdrop from './Backdrop.jsx';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import CourseCard, { CourseCardSkeleton } from './CourseCard.jsx';
import CourseCover from './CourseCover.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import styles from './Landing.module.scss';

// The demo's one-click sign-in, only in demo builds (its own chunk, with the mock API).
const PersonaChooser = DEMO ? lazy(() => import('../demo/PersonaChooser.jsx')) : null;

const FEATURES = [
  {
    icon: 'film',
    title: 'Video lessons',
    text: 'Upload once and every lesson streams in the right size for each screen. Only what is actually watched counts, and students resume where they stopped.',
  },
  {
    icon: 'quiz',
    title: 'Quizzes',
    text: 'One answer, several, or a short typed one, graded on the spot. The right answers show once a student passes or runs out of attempts.',
  },
  {
    icon: 'assignment',
    title: 'Assignments',
    text: 'Written answers and files, handed in by a due date. Instructors grade with feedback, or hand work back for another try.',
  },
  {
    icon: 'checkCircle',
    title: 'Progress',
    text: 'Every course shows how far each student is, and Continue learning opens the right lesson, on any device.',
  },
  {
    icon: 'chart',
    title: 'Insights',
    text: 'Completion lesson by lesson, where viewers stop watching, which questions trip students up, and how the grades are going.',
  },
  {
    icon: 'bell',
    title: 'Live notifications',
    text: 'New courses and lessons, handed-in work and grades arrive the moment they happen: in the app, and by email if people choose.',
  },
];

const STEPS = [
  { title: 'Create your school', text: 'It gets its own address, and stays private to its members.' },
  { title: 'Invite your people', text: 'Instructors build courses; students join with an email invitation.' },
  { title: 'Publish and follow along', text: 'Students learn at their own pace while you see how it’s going.' },
];

/** A glimpse of the app, drawn with its own parts (no screenshots): decorative, beside the hero. */
function Glimpse({ course }) {
  const sample = course ?? { slug: 'linear-algebra', title: 'Linear Algebra Basics' };
  const curve = [100, 97, 94, 92, 90, 86, 74, 71, 70, 69, 68, 68];
  const points = curve.map((value, index) => `${(index / (curve.length - 1)) * 200},${60 - value * 0.5}`).join(' ');
  return (
    <div className={styles.glimpse} aria-hidden="true">
      <m.div className={`${styles.card} ${styles.courseCard}`} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}>
        <div className={styles.thumb}>
          <CourseCover course={{ ...sample, coverUrl: null }} variant="thumb" />
        </div>
        <p className={styles.cardEyebrow}>Continue learning</p>
        <p className={styles.cardTitle}>{sample.title}</p>
        <ProgressBar value={57} size="md" />
        <p className={`${styles.cardMeta} tabular`}>4 of 7 lessons done · 57%</p>
      </m.div>
      <m.div className={`${styles.card} ${styles.quizCard}`} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }}>
        <p className={styles.cardEyebrow}>Quiz</p>
        <p className={styles.cardTitle}>Check your understanding</p>
        <Badge tone="success" icon="check">
          Passed · 83%
        </Badge>
        <ul className={styles.answers}>
          <li data-right>
            <Icon name="check" size={14} />
            Columns are where î and ĵ land
          </li>
          <li data-right>
            <Icon name="check" size={14} />
            Area scales by the determinant
          </li>
          <li>
            <Icon name="close" size={14} />
            AB means A first, then B
          </li>
        </ul>
      </m.div>
      <m.div className={`${styles.card} ${styles.insightCard}`} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.4 }}>
        <p className={styles.cardEyebrow}>Insights</p>
        <p className={styles.cardTitle}>Where students stop watching</p>
        <svg viewBox="0 0 200 64" className={styles.chart} preserveAspectRatio="none">
          <polygon points={`0,64 ${points} 200,64`} className={styles.area} />
          <polyline points={points} className={styles.line} />
        </svg>
        <p className={`${styles.cardMeta} tabular`}>68% reach the end</p>
      </m.div>
    </div>
  );
}

/** A titled section of the page. */
function Section({ title, lede, children, className = '' }) {
  const id = useId();
  return (
    <section className={`${styles.section} ${className}`} aria-labelledby={id}>
      <header className={styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {lede && <p className={styles.sectionLede}>{lede}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * The home page for visitors: what Grand LMS is, the way in (the demo school, or creating a
 * school), and what it does. In the demo, the demo school's people and most popular courses are
 * right here: one click signs in as any of them.
 */
export default function Landing() {
  const navigate = useNavigate();
  const showcase = useQuery({
    queryKey: ['demo', 'showcase'],
    queryFn: () => loadDemo().then((demo) => demo.showcase()),
    enabled: DEMO,
    staleTime: Infinity,
  });
  const school = showcase.data?.school;
  const featured = showcase.data?.courses ?? [];

  return (
    <div className={styles.landing}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <Backdrop />
        <div className={styles.heroInner}>
          <m.div className={styles.heroText} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
            <p className={styles.eyebrow}>
              <Icon name="school" size={16} />A learning platform for schools
            </p>
            <h1 id="landing-title" className={styles.title}>
              Teach with video. <span className={styles.accent}>See every student’s progress.</span>
            </h1>
            <p className={styles.lede}>
              Grand LMS brings a school’s courses together: video lessons, quizzes, assignments with feedback, each student’s progress, and insights into how every course is going.
            </p>
            <div className={styles.actions}>
              {DEMO ? (
                <Button variant="primary" icon="play" to="/signin" className={styles.cta}>
                  Explore the demo school
                </Button>
              ) : (
                <>
                  <Button variant="primary" icon="plus" to={authPath('signup', '/schools/new')} className={styles.cta}>
                    Create your school
                  </Button>
                  <Button variant="secondary" to="/signin" className={styles.cta}>
                    Sign in
                  </Button>
                </>
              )}
            </div>
            {DEMO && (
              <p className={styles.note}>
                <Icon name="info" size={16} />
                <span>A demo school with sample people and courses. Nothing to install, and nothing leaves this browser.</span>
              </p>
            )}
          </m.div>
          <Glimpse course={featured[0]} />
        </div>
      </section>

      <div className={`page ${styles.body}`}>
        {DEMO && (
          <Section title="Try the demo as…" lede={`Step into ${school?.name ?? 'the demo school'} as one of its people. One click, no sign-up.`}>
            <Suspense fallback={<div className={styles.personasLoading} aria-busy="true" />}>
              <PersonaChooser layout="row" onSignedIn={(user) => navigate(loadedDemo()?.startPage(user.id) ?? '/')} />
            </Suspense>
          </Section>
        )}

        {DEMO && (
          <Section title={school ? `Inside ${school.name}` : 'Inside the demo school'} lede={school?.description || 'Some of the courses in the demo school.'}>
            <ul className={styles.courses} aria-busy={showcase.isPending || undefined}>
              {showcase.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <li key={i}>
                      <CourseCardSkeleton />
                    </li>
                  ))
                : featured.map((course, i) => (
                    <li key={course.id}>
                      <CourseCard course={course} schoolSlug={school.slug} index={i} priority={i < 3} />
                    </li>
                  ))}
            </ul>
          </Section>
        )}

        <Section title="Everything a school needs to teach online" lede="One place for every course, every lesson and every student, from the first video to the final grade.">
          <ul className={styles.features}>
            {FEATURES.map((feature, i) => (
              <li key={feature.title} className={styles.feature} style={{ '--i': i }}>
                <span className={styles.featureIcon}>
                  <Icon name={feature.icon} size={22} />
                </span>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureText}>{feature.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Up and running in an afternoon">
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={`${styles.stepNumber} tabular`} aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className={styles.featureTitle}>{step.title}</h3>
                  <p className={styles.featureText}>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <h2 id="closing-title" className={styles.closingTitle}>
            {DEMO ? 'See it from the inside' : 'Start your school today'}
          </h2>
          <p className={styles.sectionLede}>
            {DEMO
              ? 'Sign in as a student, an instructor or the school’s owner, and try everything: it’s all yours to change.'
              : 'Free to start. Your school, your courses, your students.'}
          </p>
          <div className={styles.actions}>
            {DEMO ? (
              <Button variant="primary" icon="play" to="/signin" className={styles.cta}>
                Explore the demo school
              </Button>
            ) : (
              <Button variant="primary" icon="plus" to={authPath('signup', '/schools/new')} className={styles.cta}>
                Create your school
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
