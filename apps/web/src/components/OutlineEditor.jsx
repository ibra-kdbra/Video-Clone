import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { moduleInput } from '@grand/contracts';

import { addModule, createLesson, deleteModule, keys, renameModule, saveOutline } from '../lib/courses.js';
import { errorMessage } from '../lib/forms.js';
import {
  canMoveLesson,
  describePosition,
  lessonNumbers,
  locateLesson,
  moveLesson,
  moveLessonBy,
  moveModule,
  moveModuleBy,
  sameOrder,
  toOutlineInput,
} from '../lib/outline.js';
import { toast } from '../lib/toast.js';
import { useForm } from '../lib/useForm.js';
import { useUploads } from '../lib/uploads.js';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { TextField } from './Field.jsx';
import Icon from './Icon.jsx';
import LessonVideoBadge from './LessonVideoBadge.jsx';
import styles from './OutlineEditor.module.scss';

const moduleKey = (id) => `m:${id}`;
const lessonKey = (id) => `l:${id}`;
const idOf = (key) => String(key).slice(2);
const isModuleKey = (key) => String(key).startsWith('m:');

/** A one-field form in place (add or rename a module, add a lesson): Enter saves, Escape cancels. */
function InlineForm({ label, initial = '', submitLabel, onSubmit, onCancel, keepOpen = false }) {
  const form = useForm(moduleInput, { title: initial }, ['title']);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = form.validate();
    if (!input) return;
    setBusy(true);
    try {
      await onSubmit(input.title);
      if (keepOpen) {
        form.update({ title: '' });
        form.refs.title.current?.focus();
      }
    } catch (error) {
      form.fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.inline} onSubmit={submit} noValidate>
      <TextField
        {...form.bind('title')}
        label={label}
        maxLength={120}
        autoComplete="off"
        autoFocus
        error={form.errors.title ?? form.errors['']}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onCancel();
        }}
        className={styles.inlineField}
      />
      <div className={styles.inlineActions}>
        <Button type="submit" size="sm" variant="primary" busy={busy}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {keepOpen ? 'Done' : 'Cancel'}
        </Button>
      </div>
    </form>
  );
}

/** A small square button for the rows' actions (move up and down, edit). */
function RowButton({ icon, label, onClick, disabled, focusKey }) {
  return (
    <button type="button" className={styles.rowButton} onClick={onClick} disabled={disabled} aria-label={label} title={label} data-focus={focusKey}>
      <Icon name={icon} size={18} />
    </button>
  );
}

function LessonRow({ lesson, number, modules, upload, onOpen, onMove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: lessonKey(lesson.id),
    data: { type: 'lesson', moduleId: lesson.moduleId, title: lesson.title },
  });
  const running = upload && upload.phase !== 'failed';
  const share = running && upload.size ? upload.loaded / upload.size : 0;

  return (
    <li ref={setNodeRef} className={styles.lesson} data-dragging={isDragging || undefined} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <button ref={setActivatorNodeRef} type="button" className={styles.grip} {...attributes} {...listeners} aria-label={`Move lesson: ${lesson.title}`}>
        <Icon name="grip" size={18} />
      </button>
      <span className={`${styles.number} tabular`} aria-hidden="true">
        {number}
      </span>
      <div className={styles.lessonMain}>
        <button type="button" className={styles.lessonTitle} onClick={() => onOpen(lesson.id)}>
          <span className="visually-hidden">Lesson {number}: </span>
          {lesson.title}
          <span className="visually-hidden"> (edit)</span>
        </button>
        <div className={styles.badges}>
          <Badge tone={lesson.status === 'published' ? 'success' : 'warning'}>{lesson.status === 'published' ? 'Published' : 'Draft'}</Badge>
          {lesson.isPreview && <Badge tone="teal">Free preview</Badge>}
          <LessonVideoBadge lesson={lesson} upload={upload} />
        </div>
        {running && <span className={styles.uploadBar} style={{ '--share': share }} aria-hidden="true" />}
      </div>
      <div className={styles.rowActions}>
        <RowButton
          icon="arrowUp"
          label={`Move "${lesson.title}" up`}
          onClick={() => onMove(lesson.id, -1)}
          disabled={!canMoveLesson(modules, lesson.id, -1)}
          focusKey={`l:${lesson.id}:up`}
        />
        <RowButton
          icon="arrowDown"
          label={`Move "${lesson.title}" down`}
          onClick={() => onMove(lesson.id, 1)}
          disabled={!canMoveLesson(modules, lesson.id, 1)}
          focusKey={`l:${lesson.id}:down`}
        />
        <span className={styles.wideOnly}>
          <RowButton icon="edit" label={`Edit "${lesson.title}"`} onClick={() => onOpen(lesson.id)} />
        </span>
      </div>
    </li>
  );
}

function ModuleCard({
  module,
  index,
  count,
  modules,
  numbers,
  uploads,
  editing,
  setEditing,
  onMove,
  onMoveLesson,
  onRename,
  onDelete,
  onAddLesson,
  onOpenLesson,
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: moduleKey(module.id),
    data: { type: 'module', moduleId: module.id, title: module.title },
  });
  const renaming = editing === `rename:${module.id}`;
  const adding = editing === `add:${module.id}`;

  return (
    <li ref={setNodeRef} className={styles.module} data-dragging={isDragging || undefined} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <div className={styles.moduleHead}>
        <button ref={setActivatorNodeRef} type="button" className={styles.grip} {...attributes} {...listeners} aria-label={`Move module: ${module.title}`}>
          <Icon name="grip" size={18} />
        </button>
        {renaming ? (
          <InlineForm
            label={`Rename module ${index + 1}`}
            initial={module.title}
            submitLabel="Save"
            onSubmit={async (title) => {
              await onRename(module, title);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <h3 className={styles.moduleTitle}>
              <span className={styles.moduleIndex}>Module {index + 1}</span>
              <span className={styles.moduleName}>{module.title}</span>
            </h3>
            <div className={styles.rowActions}>
              <RowButton
                icon="arrowUp"
                label={`Move module "${module.title}" up`}
                onClick={() => onMove(module.id, -1)}
                disabled={index === 0}
                focusKey={`m:${module.id}:up`}
              />
              <RowButton
                icon="arrowDown"
                label={`Move module "${module.title}" down`}
                onClick={() => onMove(module.id, 1)}
                disabled={index === count - 1}
                focusKey={`m:${module.id}:down`}
              />
              <RowButton icon="edit" label={`Rename module "${module.title}"`} onClick={() => setEditing(`rename:${module.id}`)} />
              {count > 1 && <RowButton icon="trash" label={`Delete module "${module.title}"`} onClick={() => onDelete(module)} />}
            </div>
          </>
        )}
      </div>

      <SortableContext items={module.lessons.map((lesson) => lessonKey(lesson.id))} strategy={verticalListSortingStrategy}>
        <ol className={styles.lessons} aria-label={`Lessons in ${module.title}`}>
          {module.lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              number={numbers.get(lesson.id)}
              modules={modules}
              upload={uploads.get(lesson.id)}
              onOpen={onOpenLesson}
              onMove={onMoveLesson}
            />
          ))}
        </ol>
      </SortableContext>
      {module.lessons.length === 0 && !adding && <p className={styles.emptyModule}>No lessons yet. Add one, or drag a lesson here.</p>}

      <div className={styles.moduleFoot}>
        {adding ? (
          <InlineForm
            label={`New lesson in ${module.title}`}
            submitLabel="Add lesson"
            keepOpen
            onSubmit={(title) => onAddLesson(module, title)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button type="button" className={styles.add} onClick={() => setEditing(`add:${module.id}`)}>
            <Icon name="plus" size={18} />
            Add lesson
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The course's outline, to build and reorder: modules and their lessons, added and renamed in
 * place, and moved by dragging their handles (mouse, touch, or the keyboard: Space to lift, arrows,
 * Space to drop) or with the Move up and Move down buttons, which also carry a lesson into the
 * next or previous module. Every change shows at once and is saved in the background (PUT outline);
 * if the server refuses, the previous order comes back, and if the course changed elsewhere, the
 * latest version is loaded. Pressing a lesson opens it in the lesson editor.
 */
export default function OutlineEditor({ course, schoolSlug, onOpenLesson }) {
  const queryClient = useQueryClient();
  const key = keys.course(schoolSlug, course.slug);
  const [dragModules, setDragModules] = useState(null);
  const [active, setActive] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState(0);
  const queue = useRef(Promise.resolve());
  const latest = useRef(0);
  const pendingFocus = useRef(null);
  const root = useRef(null);
  const heading = useRef(null);
  const uploadList = useUploads();
  const uploads = new Map(uploadList.map((entry) => [entry.lessonId, entry]));

  const modules = dragModules ?? course.modules;
  const numbers = lessonNumbers(modules);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // After a move with the buttons, the row has moved in the page (into another module, it's even
  // a new element): once the new order is on screen, focus goes back to the same button, or to the
  // other arrow when this one no longer applies (at the top or bottom).
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !sameOrder(pending.modules, modules)) return;
    pendingFocus.current = null;
    const find = (name) => root.current?.querySelector(`[data-focus="${name}"]`);
    const button = find(pending.key);
    if (button && !button.disabled) button.focus();
    else find(pending.key.endsWith(':up') ? pending.key.replace(/:up$/, ':down') : pending.key.replace(/:down$/, ':up'))?.focus();
  });

  /** Shows the new order at once and saves it, one save at a time; the last one decides. */
  const commit = useCallback(
    (next, message) => {
      const previous = queryClient.getQueryData(key);
      if (!previous || sameOrder(previous.modules, next)) return;
      queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, { ...previous, modules: next });
      if (message) setAnnouncement(message);
      const sequence = ++latest.current;
      setSaving((count) => count + 1);
      queue.current = queue.current
        .then(() => saveOutline(schoolSlug, course.slug, toOutlineInput(next)))
        .then((saved) => {
          if (sequence === latest.current) queryClient.setQueryData(key, saved);
        })
        .catch((error) => {
          if (sequence !== latest.current) return;
          if (error?.status === 409) {
            toast('The outline was changed elsewhere, so here is the latest version.', { tone: 'info' });
          } else {
            queryClient.setQueryData(key, (current) => current && { ...current, modules: previous.modules });
            toast(`The new order wasn't saved. ${errorMessage(error)}`, { tone: 'error' });
          }
          queryClient.invalidateQueries({ queryKey: key });
        })
        .finally(() => setSaving((count) => count - 1));
    },
    [queryClient, key, schoolSlug, course.slug],
  );

  const moveModuleButton = (moduleId, delta) => {
    const next = moveModuleBy(modules, moduleId, delta);
    const index = next.findIndex((module) => module.id === moduleId);
    pendingFocus.current = { key: `m:${moduleId}:${delta < 0 ? 'up' : 'down'}`, modules: next };
    commit(next, `${next[index].title} moved to position ${index + 1} of ${next.length}.`);
  };

  const moveLessonButton = (lessonId, delta) => {
    const next = moveLessonBy(modules, lessonId, delta);
    if (!next) return;
    const where = locateLesson(next, lessonId);
    pendingFocus.current = { key: `l:${lessonId}:${delta < 0 ? 'up' : 'down'}`, modules: next };
    commit(next, `${next[where.moduleIndex].lessons[where.lessonIndex].title} moved to ${describePosition(next, lessonId)}.`);
  };

  const setCourse = (saved) => queryClient.setQueryData(key, saved);

  const rename = async (module, title) => {
    setCourse(await renameModule(schoolSlug, course.slug, module.id, title));
    setAnnouncement(`Module renamed to ${title}.`);
  };

  const add = async (title) => {
    setCourse(await addModule(schoolSlug, course.slug, title));
    setEditing(null);
    toast(`Module "${title}" added`);
  };

  const addLesson = async (module, title) => {
    const lesson = await createLesson(schoolSlug, course.slug, { moduleId: module.id, title });
    queryClient.setQueryData(
      key,
      (current) =>
        current && { ...current, modules: current.modules.map((item) => (item.id === module.id ? { ...item, lessons: [...item.lessons, lesson] } : item)) },
    );
    queryClient.invalidateQueries({ queryKey: keys.courses(schoolSlug) });
    setAnnouncement(`Lesson "${title}" added to ${module.title}. Type the next title, or press Escape.`);
  };

  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    try {
      setCourse(await deleteModule(schoolSlug, course.slug, removing.id));
      queryClient.invalidateQueries({ queryKey: keys.courses(schoolSlug) });
      toast(`Module "${removing.title}" deleted`);
      setRemoving(null);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      setRemoving(null);
    } finally {
      setDeleting(false);
    }
  };

  // Drag and drop ------------------------------------------------------------------------------

  const collision = useCallback((args) => {
    const kind = args.active.data.current?.type;
    const of = (type) => args.droppableContainers.filter((container) => container.data.current?.type === type);
    if (kind === 'module') return closestCenter({ ...args, droppableContainers: of('module') });
    const lessons = of('lesson');
    const overLesson = pointerWithin({ ...args, droppableContainers: lessons });
    if (overLesson.length) return overLesson;
    // Over a module but not one of its lessons (an empty module, or its edges): the nearest of its
    // lessons, or the module itself when it has none.
    const overModule = pointerWithin({ ...args, droppableContainers: of('module') });
    if (overModule.length) {
      const moduleId = idOf(overModule[0].id);
      const inside = lessons.filter((container) => container.data.current?.moduleId === moduleId);
      return inside.length ? closestCenter({ ...args, droppableContainers: inside }) : overModule;
    }
    return closestCenter({ ...args, droppableContainers: lessons });
  }, []);

  const onDragStart = ({ active: dragged }) => {
    setActive({ id: dragged.id, ...dragged.data.current });
    setDragModules(course.modules);
  };

  // A lesson dragged into another module moves there while still being dragged, so the list opens up for it.
  const onDragOver = ({ active: dragged, over }) => {
    if (!over || isModuleKey(dragged.id) || dragged.id === over.id) return;
    setDragModules((current) => {
      const list = current ?? course.modules;
      const lessonId = idOf(dragged.id);
      const from = locateLesson(list, lessonId);
      if (!from) return current;
      if (isModuleKey(over.id)) {
        const target = list.find((module) => module.id === idOf(over.id));
        if (!target || target.id === list[from.moduleIndex].id) return current;
        return moveLesson(list, lessonId, target.id, target.lessons.length);
      }
      const to = locateLesson(list, idOf(over.id));
      if (!to || to.moduleIndex === from.moduleIndex) return current;
      const below = dragged.rect.current.translated && dragged.rect.current.translated.top > over.rect.top + over.rect.height / 2;
      return moveLesson(list, lessonId, list[to.moduleIndex].id, to.lessonIndex + (below ? 1 : 0));
    });
  };

  const onDragEnd = ({ active: dragged, over }) => {
    let next = dragModules ?? course.modules;
    if (over) {
      if (isModuleKey(dragged.id)) {
        const overModule = isModuleKey(over.id) ? idOf(over.id) : over.data.current?.moduleId;
        const index = next.findIndex((module) => module.id === overModule);
        if (index !== -1) next = moveModule(next, idOf(dragged.id), index);
      } else if (!isModuleKey(over.id)) {
        const to = locateLesson(next, idOf(over.id));
        if (to) next = moveLesson(next, idOf(dragged.id), next[to.moduleIndex].id, to.lessonIndex);
      }
    }
    setActive(null);
    setDragModules(null);
    commit(next);
  };

  const onDragCancel = () => {
    setActive(null);
    setDragModules(null);
  };

  const label = (item) => (item?.data.current?.type === 'module' ? `module ${item.data.current.title}` : `lesson ${item?.data.current?.title ?? ''}`);
  const announcements = {
    onDragStart: ({ active: item }) => `Picked up ${label(item)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active: item, over }) => (over ? `${label(item)} is over ${label(over)}.` : `${label(item)} is no longer over a place to drop it.`),
    onDragEnd: ({ active: item, over }) => (over ? `Dropped ${label(item)}.` : `${label(item)} returned to its place.`),
    onDragCancel: ({ active: item }) => `Moving ${label(item)} was cancelled; it's back in its place.`,
  };

  const lessonCount = modules.reduce((sum, module) => sum + module.lessons.length, 0);

  return (
    <section className={styles.editor} aria-labelledby="outline-title" ref={root}>
      <header className={styles.head}>
        <div>
          <h2 id="outline-title" ref={heading} tabIndex={-1} className={styles.title}>
            Outline
          </h2>
          <p className={styles.lede}>
            {modules.length} {modules.length === 1 ? 'module' : 'modules'}, {lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'}. Drag the handles, or use
            the arrows, to change the order.
          </p>
        </div>
        <p className={styles.saving} aria-hidden="true">
          {saving > 0 ? (
            <>
              <span className={styles.dot} aria-hidden="true" />
              Saving the order…
            </>
          ) : null}
        </p>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: 'To move it, press Space, then use the arrow keys, and press Space again to drop it or Escape to cancel.' },
        }}
      >
        <SortableContext items={modules.map((module) => moduleKey(module.id))} strategy={verticalListSortingStrategy}>
          <ol className={styles.modules}>
            {modules.map((module, index) => (
              <ModuleCard
                key={module.id}
                module={module}
                index={index}
                count={modules.length}
                modules={modules}
                numbers={numbers}
                uploads={uploads}
                editing={editing}
                setEditing={setEditing}
                onMove={moveModuleButton}
                onMoveLesson={moveLessonButton}
                onRename={rename}
                onDelete={setRemoving}
                onAddLesson={addLesson}
                onOpenLesson={onOpenLesson}
              />
            ))}
          </ol>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className={styles.overlay}>
              <Icon name={active.type === 'module' ? 'layers' : 'film'} size={18} />
              <span>{active.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div className={styles.addModule}>
        {editing === 'module' ? (
          <InlineForm label="New module" submitLabel="Add module" onSubmit={add} onCancel={() => setEditing(null)} />
        ) : (
          <Button icon="plus" onClick={() => setEditing('module')}>
            Add module
          </Button>
        )}
      </div>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Delete "${removing?.title ?? 'this module'}"?`}
        confirmLabel="Delete module"
        busy={deleting}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
        returnFocus={heading}
      >
        <p>
          {removing?.lessons.length
            ? `Its ${removing.lessons.length === 1 ? 'lesson' : `${removing.lessons.length} lessons`} and their videos will be deleted too. This can't be undone.`
            : "It's empty, so nothing else is deleted."}
        </p>
      </ConfirmDialog>
    </section>
  );
}
