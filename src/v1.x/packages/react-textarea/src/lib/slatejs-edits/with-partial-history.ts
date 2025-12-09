import { Editor, Operation, Path, Range, Transforms } from "slate";
import { HistoryEditor } from "slate-history";

// Copy-pasted from `https://github.com/ianstormtaylor/slate/blob/main/packages/slate-history/src/with-history.ts`
// With one exception: the `shouldSave` function is passed in as an argument to `withPartialHistory` instead of being hardcoded
export type ShouldSaveToHistory = (op: Operation, prev: Operation | undefined) => boolean;

export const withPartialHistory = <T extends Editor>(
  editor: T,
  shouldSave: ShouldSaveToHistory,
) => {
  const e = editor as T & HistoryEditor;
  const { apply } = e;
  e.history = { undos: [], redos: [] };

  e.redo = () => {
    const { history } = e;
    const { redos } = history;

    if (redos.length > 0) {
      const batch = redos[redos.length - 1];

      if (batch.selectionBefore) {
        Transforms.setSelection(e, batch.selectionBefore);
      }

      HistoryEditor.withoutSaving(e, () => {
        Editor.withoutNormalizing(e, () => {
          for (const op of batch.operations) {
            e.apply(op);
          }
        });
      });

      history.redos.pop();
      e.writeHistory("undos", batch);
    }
  };

  e.undo = () => {
    const { history } = e;
    const { undos } = history;

    if (undos.length > 0) {
      const batch = undos[undos.length - 1];

      HistoryEditor.withoutSaving(e, () => {
        Editor.withoutNormalizing(e, () => {
          const inverseOps = batch.operations.map(Operation.inverse).reverse();

          for (const op of inverseOps) {
            e.apply(op);
          }
          if (batch.selectionBefore) {
            Transforms.setSelection(e, batch.selectionBefore);
          }
        });
      });

      e.writeHistory("redos", batch);
      history.undos.pop();
    }
  };

  e.apply = (op: Operation) => {
    const { operations, history } = e;
    const { undos } = history;
    const lastBatch = undos[undos.length - 1];
    const lastOp = lastBatch && lastBatch.operations[lastBatch.operations.length - 1];
    let save = HistoryEditor.isSaving(e);
    let merge = HistoryEditor.isMerging(e);

    if (save == null) {
      save = shouldSave(op, lastOp);
    }

    if (save) {
      if (merge == null) {
        if (lastBatch == null) {
          merge = false;
        } else if (operations.length !== 0) {
          merge = true;
        } else {
          merge = shouldMerge(op, lastOp);
        }
      }

      if (lastBatch && merge) {
        lastBatch.operations.push(op);
      } else {
        const batch = {
          operations: [op],
          selectionBefore: e.selection,
        };
        e.writeHistory("undos", batch);
      }

      while (undos.length > 100) {
        undos.shift();
      }

      history.redos = [];
    }

    apply(op);
  };

  e.writeHistory = (stack: "undos" | "redos", batch: any) => {
    e.history[stack].push(batch);
  };

  return e;
};

/**
 * Check whether to merge an operation into the previous operation.
 */

const shouldMerge = (op: Operation, prev: Operation | undefined): boolean => {
  if (
    prev &&
    op.type === "insert_text" &&
    prev.type === "insert_text" &&
    op.offset === prev.offset + prev.text.length &&
    Path.equals(op.path, prev.path)
  ) {
    return true;
  }

  if (
    prev &&
    op.type === "remove_text" &&
    prev.type === "remove_text" &&
    op.offset + op.text.length === prev.offset &&
    Path.equals(op.path, prev.path)
  ) {
    return true;
  }

  return false;
};

export const defaultShouldSave = (op: Operation, prev: Operation | undefined): boolean => {
  if (op.type === "set_selection") {
    return false;
  }

  return true;
};
