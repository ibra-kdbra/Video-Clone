import { describe, expect, it } from 'vitest';

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
} from '../src/lib/outline.js';

const lesson = (id, moduleId) => ({ id, moduleId, title: `Lesson ${id}` });
const outline = () => [
  { id: 'm1', title: 'Basics', lessons: [lesson('a', 'm1'), lesson('b', 'm1'), lesson('c', 'm1')] },
  { id: 'm2', title: 'Practice', lessons: [lesson('d', 'm2')] },
  { id: 'm3', title: 'Extras', lessons: [] },
];
const order = (modules) => modules.map((module) => `${module.id}:${module.lessons.map((item) => item.id).join('')}`).join(' ');

describe('the outline as the API takes it', () => {
  it('lists every module with its lesson ids, in order', () => {
    expect(toOutlineInput(outline())).toEqual({
      modules: [
        { id: 'm1', lessonIds: ['a', 'b', 'c'] },
        { id: 'm2', lessonIds: ['d'] },
        { id: 'm3', lessonIds: [] },
      ],
    });
  });

  it('compares orders', () => {
    expect(sameOrder(outline(), outline())).toBe(true);
    expect(sameOrder(outline(), moveModule(outline(), 'm3', 0))).toBe(false);
  });
});

describe('moving modules', () => {
  it('moves one to a new position without changing the original', () => {
    const before = outline();
    const after = moveModule(before, 'm1', 2);
    expect(order(after)).toBe('m2:d m3: m1:abc');
    expect(order(before)).toBe('m1:abc m2:d m3:');
  });

  it('by one place, staying put at the ends', () => {
    expect(order(moveModuleBy(outline(), 'm2', -1))).toBe('m2:d m1:abc m3:');
    const modules = outline();
    expect(moveModuleBy(modules, 'm1', -1)).toBe(modules);
    expect(moveModuleBy(modules, 'm3', 1)).toBe(modules);
    expect(moveModule(modules, 'nope', 0)).toBe(modules);
  });
});

describe('moving lessons', () => {
  it('within a module', () => {
    expect(order(moveLesson(outline(), 'a', 'm1', 2))).toBe('m1:bca m2:d m3:');
    const modules = outline();
    expect(moveLesson(modules, 'b', 'm1', 1)).toBe(modules);
  });

  it('into another module, which becomes its module', () => {
    const after = moveLesson(outline(), 'b', 'm2', 0);
    expect(order(after)).toBe('m1:ac m2:bd m3:');
    expect(after[1].lessons[0].moduleId).toBe('m2');
    expect(order(moveLesson(outline(), 'd', 'm3', 5))).toBe('m1:abc m2: m3:d');
  });

  it('by one place, crossing into the next or previous module at the edges', () => {
    expect(order(moveLessonBy(outline(), 'b', 1))).toBe('m1:acb m2:d m3:');
    expect(order(moveLessonBy(outline(), 'c', 1))).toBe('m1:ab m2:cd m3:');
    expect(order(moveLessonBy(outline(), 'd', -1))).toBe('m1:abcd m2: m3:');
    // Into an empty module.
    expect(order(moveLessonBy(outline(), 'd', 1))).toBe('m1:abc m2: m3:d');
    expect(moveLessonBy(outline(), 'a', -1)).toBeNull();
    expect(moveLessonBy(outline(), 'zzz', 1)).toBeNull();
  });

  it('knows when a lesson can move at all', () => {
    const modules = outline();
    expect(canMoveLesson(modules, 'a', -1)).toBe(false);
    expect(canMoveLesson(modules, 'a', 1)).toBe(true);
    expect(canMoveLesson(modules, 'd', 1)).toBe(true);
    const last = [{ id: 'm1', title: 'Only', lessons: [lesson('x', 'm1')] }];
    expect(canMoveLesson(last, 'x', 1)).toBe(false);
    expect(canMoveLesson(last, 'x', -1)).toBe(false);
  });
});

describe('positions', () => {
  it('finds lessons, numbers them across modules, and says where one is', () => {
    const modules = outline();
    expect(locateLesson(modules, 'd')).toEqual({ moduleIndex: 1, lessonIndex: 0 });
    expect(locateLesson(modules, 'nope')).toBeNull();
    expect([...lessonNumbers(modules)]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
    expect(describePosition(moveLessonBy(modules, 'c', 1), 'c')).toBe('Practice, position 1 of 2');
  });
});
