/**
 * Reordering a course's outline (its modules, each with its lessons) without changing it in
 * place: every helper returns new arrays, so a cached course can be swapped optimistically and
 * put back if the server refuses. The server takes the whole order at once (PUT …/outline).
 */

/** The outline in the shape PUT …/outline expects. */
export const toOutlineInput = (modules) => ({ modules: modules.map((module) => ({ id: module.id, lessonIds: module.lessons.map((lesson) => lesson.id) })) });

/** Whether two outlines list the same modules and lessons in the same order. */
export const sameOrder = (a, b) => JSON.stringify(toOutlineInput(a)) === JSON.stringify(toOutlineInput(b));

/** Where a lesson is: its module's index and its own index in that module, or null. */
export function locateLesson(modules, lessonId) {
  for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
    const lessonIndex = modules[moduleIndex].lessons.findIndex((lesson) => lesson.id === lessonId);
    if (lessonIndex !== -1) return { moduleIndex, lessonIndex };
  }
  return null;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** The modules with one of them moved to `toIndex`. Unchanged (same array) when there's no move. */
export function moveModule(modules, moduleId, toIndex) {
  const from = modules.findIndex((module) => module.id === moduleId);
  if (from === -1) return modules;
  const to = clamp(toIndex, 0, modules.length - 1);
  if (to === from) return modules;
  const next = [...modules];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Moves a module one place up (-1) or down (+1). */
export function moveModuleBy(modules, moduleId, delta) {
  const from = modules.findIndex((module) => module.id === moduleId);
  return from === -1 ? modules : moveModule(modules, moduleId, from + delta);
}

/**
 * The modules with a lesson moved to position `toIndex` of module `toModuleId` (which may be its
 * own). The lesson's `moduleId` follows it. Unchanged (same array) when there's no move.
 */
export function moveLesson(modules, lessonId, toModuleId, toIndex) {
  const where = locateLesson(modules, lessonId);
  const target = modules.findIndex((module) => module.id === toModuleId);
  if (!where || target === -1) return modules;
  const sameModule = where.moduleIndex === target;
  const limit = modules[target].lessons.length - (sameModule ? 1 : 0);
  const to = clamp(toIndex, 0, limit);
  if (sameModule && to === where.lessonIndex) return modules;

  const lesson = { ...modules[where.moduleIndex].lessons[where.lessonIndex], moduleId: toModuleId };
  return modules.map((module, index) => {
    if (index !== where.moduleIndex && index !== target) return module;
    const lessons = index === where.moduleIndex ? module.lessons.filter((item) => item.id !== lessonId) : [...module.lessons];
    if (index === target) lessons.splice(to, 0, lesson);
    return { ...module, lessons };
  });
}

/**
 * Moves a lesson one place up (-1) or down (+1). At the edge of its module it crosses into the
 * next module (at its start) or the previous one (at its end), so buttons alone can take a lesson
 * anywhere. Returns null when it's already first or last in the course.
 */
export function moveLessonBy(modules, lessonId, delta) {
  const where = locateLesson(modules, lessonId);
  if (!where) return null;
  const { moduleIndex, lessonIndex } = where;
  const count = modules[moduleIndex].lessons.length;
  const target = lessonIndex + delta;
  if (target >= 0 && target < count) return moveLesson(modules, lessonId, modules[moduleIndex].id, target);
  const neighbour = moduleIndex + (delta < 0 ? -1 : 1);
  if (neighbour < 0 || neighbour >= modules.length) return null;
  return moveLesson(modules, lessonId, modules[neighbour].id, delta < 0 ? modules[neighbour].lessons.length : 0);
}

/** Whether a lesson can move up (-1) or down (+1) at all. */
export function canMoveLesson(modules, lessonId, delta) {
  const where = locateLesson(modules, lessonId);
  if (!where) return false;
  if (delta < 0) return where.lessonIndex > 0 || where.moduleIndex > 0;
  return where.lessonIndex < modules[where.moduleIndex].lessons.length - 1 || where.moduleIndex < modules.length - 1;
}

/** Each lesson's number in the course (1, 2, 3… across modules), by id. */
export function lessonNumbers(modules) {
  const numbers = new Map();
  let next = 1;
  for (const module of modules) for (const lesson of module.lessons) numbers.set(lesson.id, next++);
  return numbers;
}

/** "Module 2, position 1": where something now is, for screen-reader announcements. */
export function describePosition(modules, lessonId) {
  const where = locateLesson(modules, lessonId);
  if (!where) return '';
  const module = modules[where.moduleIndex];
  return `${module.title}, position ${where.lessonIndex + 1} of ${module.lessons.length}`;
}
