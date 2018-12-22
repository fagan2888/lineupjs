import {IAbortAblePromise, ABORTED, IAbortAblePromiseBase} from 'lineupengine';
export {IAbortAblePromise, ABORTED} from 'lineupengine';

/**
 * @internal
 */
export interface IPoorManIdleDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

/**
 * @internal
 */
export interface IPoorManIdleCallback {
  requestIdleCallback(callback: (deadline: IPoorManIdleDeadline) => void, options?: {timeout: number}): number;

  clearIdleCallback(callbackId: number): void;
}

/**
 * @internal
 */
export interface ITask<T> {
  id: string;
  it: Iterator<T | PromiseLike<T> | null>;
  resolve(r: T | PromiseLike<T> | symbol): void;
  result: PromiseLike<T | symbol>;
}

/**
 * @internal
 */
export const ANOTHER_ROUND = {
  value: null,
  done: false
};

/**
 * @internal
 */
export function oneShotIterator<T>(calc: () => T): Iterator<T> {
  return {
    next: () => ({done: true, value: calc()})
  };
}


function thenFactory<T>(wrappee: PromiseLike<T>, abort: () => void) {
  function then<TResult1 = T | symbol, TResult2 = never>(onfulfilled?: ((value: T | symbol) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): IAbortAblePromiseBase<TResult1 | TResult2> {
    const r = wrappee.then(onfulfilled, onrejected);
    return {
      then: <any>thenFactory(r, abort),
      abort
    };
  }
  return then;
}

/**
 * @internal
 */
export default class TaskScheduler {
  private tasks: ITask<any>[] = [];
  private taskId: number = -1;

  private runTasks = (deadline: IPoorManIdleDeadline) => {
    while (this.tasks.length > 0 && (deadline.didTimeout || deadline.timeRemaining() > 0)) {
      const task = this.tasks.shift()!;

      let r = task.it.next();
      // call next till done or ran out of time
      while (!r.done && (deadline.didTimeout || deadline.timeRemaining() > 0)) {
        r = task.it.next();
      }
      if (r.done) {
        requestAnimationFrame(() => task.resolve(r.value));
      } else {
        // reschedule again
        this.tasks.unshift(task);
      }
    }

    this.taskId = -1;
    this.reSchedule();
  }

  private reSchedule() {
    if (this.tasks.length === 0 || this.taskId > -1) {
      return;
    }

    const ww = (<IPoorManIdleCallback><any>self);
    if (ww.requestIdleCallback) {
      this.taskId = ww.requestIdleCallback(this.runTasks);
    } else {
      this.taskId = self.setTimeout(this.runTasks, 1);
    }
  }

  pushMulti<T>(id: string, it: Iterator<T | PromiseLike<T> | null>): IAbortAblePromise<T> {
    // abort task with the same id
    const abort = () => {
      const index = this.tasks.findIndex((d) => d.id === id);
      if (index < 0) {
        return; // too late or none
      }
      const task = this.tasks[index];
      this.tasks.splice(index, 1);

      task.resolve(ABORTED);
    };

    abort(); // abort existing with same id

    let resolve: (value: T | symbol) => void;

    const p = new Promise<T | symbol>((r) => {
      // called during constructor
      resolve = r;
    });

    this.tasks.push({
      id,
      it,
      result: p,
      resolve: resolve!
    });

    this.reSchedule();

    return {
      then: thenFactory(p, abort),
      abort
    };
  }

  push<T>(id: string, calc: () => T | PromiseLike<T>): IAbortAblePromise<T> {
    return this.pushMulti(id, oneShotIterator(calc));
  }

  abort(id: string) {
    const index = this.tasks.findIndex((d) => d.id === id);
    if (index < 0) {
      return false; // too late or none
    }
    const task = this.tasks[index];
    this.tasks.splice(index, 1);

    task.resolve(ABORTED);
    return true;
  }

  abortAll(filter: (task: ITask<any>) => boolean) {
    const abort = this.tasks.filter(filter);
    if (abort.length === 0) {
      return;
    }
    this.tasks = this.tasks.filter((d) => !filter(d));
    for (const task of abort) {
      task.resolve(ABORTED);
    }
  }

  clear() {
    if (this.taskId === -1) {
      return;
    }
    const ww = (<IPoorManIdleCallback><any>self);
    if (ww.requestIdleCallback) {
      ww.clearIdleCallback(this.taskId);
    } else {
      self.clearTimeout(this.taskId);
    }
    this.taskId = -1;

    this.tasks.splice(0, this.tasks.length).forEach((d) => d.resolve(ABORTED));
  }
}
