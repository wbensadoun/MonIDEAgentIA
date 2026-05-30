const splitLines = (content) => String(content || '').split('\n');

const buildFallbackDiff = (oldLines, newLines) => ([
  ...oldLines.map((text) => ({ type: 'remove', text })),
  ...newLines.map((text) => ({ type: 'add', text }))
]);

export const normalizeDiffHunks = (hunks = []) => (
  (Array.isArray(hunks) ? hunks : []).map((hunk, hunkIndex) => {
    const id = hunk.id || `hunk-${hunkIndex + 1}`;
    return {
      ...hunk,
      id,
      lines: (Array.isArray(hunk.lines) ? hunk.lines : []).map((line, lineIndex) => ({
        ...line,
        id: line.id || `${id}:line-${lineIndex + 1}`
      }))
    };
  })
);

export const buildLineDiff = (oldContent, newContent) => {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const cellCount = oldLines.length * newLines.length;

  if (oldContent === newContent) {
    return oldLines.map((text) => ({ type: 'context', text }));
  }

  if (cellCount > 250000) {
    return buildFallbackDiff(oldLines, newLines);
  }

  const dp = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ type: 'context', text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'remove', text: oldLines[i] });
      i += 1;
    } else {
      lines.push({ type: 'add', text: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    lines.push({ type: 'remove', text: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    lines.push({ type: 'add', text: newLines[j] });
    j += 1;
  }
  return lines;
};

export const buildDiffHunks = (oldContent, newContent, contextLines = 3) => {
  const diffLines = buildLineDiff(oldContent, newContent);
  const hunks = [];
  let oldLine = 1;
  let newLine = 1;
  let current = null;
  let trailingContext = 0;

  const startHunk = (index) => {
    const context = diffLines
      .slice(Math.max(0, index - contextLines), index)
      .filter((line) => line.type === 'context');
    const contextOldStart = Math.max(1, oldLine - context.length);
    const contextNewStart = Math.max(1, newLine - context.length);
    return {
      id: `hunk-${hunks.length + 1}`,
      oldStart: contextOldStart,
      newStart: contextNewStart,
      oldLines: context.length,
      newLines: context.length,
      additions: 0,
      deletions: 0,
      lines: context.map((line, contextIndex) => ({
        ...line,
        oldLineNumber: contextOldStart + contextIndex,
        newLineNumber: contextNewStart + contextIndex
      }))
    };
  };

  diffLines.forEach((line, index) => {
    const changed = line.type === 'add' || line.type === 'remove';
    if (changed && !current) {
      current = { ...startHunk(index), _lastIndex: index };
      trailingContext = 0;
    }

    if (current) {
      if (changed || trailingContext < contextLines) {
        current.lines.push({
          ...line,
          oldLineNumber: line.type === 'add' ? null : oldLine,
          newLineNumber: line.type === 'remove' ? null : newLine
        });
        if (line.type === 'add') {
          current.additions += 1;
          current.newLines += 1;
        } else if (line.type === 'remove') {
          current.deletions += 1;
          current.oldLines += 1;
        } else {
          current.oldLines += 1;
          current.newLines += 1;
        }
      }

      trailingContext = changed ? 0 : trailingContext + 1;
      if (!changed && trailingContext >= contextLines) {
        hunks.push({
          ...current,
          oldLines: current.lines.filter((entry) => entry.type !== 'add').length,
          newLines: current.lines.filter((entry) => entry.type !== 'remove').length
        });
        current = null;
      }
    }

    if (line.type !== 'add') oldLine += 1;
    if (line.type !== 'remove') newLine += 1;
  });

  if (current) {
    hunks.push({
      ...current,
      oldLines: current.lines.filter((entry) => entry.type !== 'add').length,
      newLines: current.lines.filter((entry) => entry.type !== 'remove').length
    });
  }

  return normalizeDiffHunks(hunks.map(({ _lastIndex, ...hunk }) => hunk));
};

export const summarizeDiff = (oldContent, newContent) => {
  const hunks = buildDiffHunks(oldContent, newContent);
  return {
    hunks,
    additions: hunks.reduce((sum, hunk) => sum + hunk.additions, 0),
    deletions: hunks.reduce((sum, hunk) => sum + hunk.deletions, 0)
  };
};

export const buildContentFromSelectedHunks = (oldContent, newContent, selectedHunkIds) => {
  const selected = new Set(selectedHunkIds || []);
  const hunks = buildDiffHunks(oldContent, newContent, 0);
  const result = splitLines(oldContent);

  [...hunks].reverse().forEach((hunk) => {
    const replacement = hunk.lines
      .filter((line) => selected.has(hunk.id) ? line.type !== 'remove' : line.type !== 'add')
      .map((line) => line.text);
    const oldLineCount = hunk.lines.filter((line) => line.type !== 'add').length;
    result.splice(Math.max(0, hunk.oldStart - 1), oldLineCount, ...replacement);
  });

  return result.join('\n');
};

export const buildContentFromSelectedLines = (oldContent, newContent, selectedLineIds, sourceHunks = null) => {
  const selected = new Set(selectedLineIds || []);
  const hunks = normalizeDiffHunks(
    Array.isArray(sourceHunks) && sourceHunks.length > 0
      ? sourceHunks
      : buildDiffHunks(oldContent, newContent)
  );
  const result = splitLines(oldContent);

  [...hunks].reverse().forEach((hunk) => {
    const replacement = [];
    for (let index = 0; index < hunk.lines.length; index += 1) {
      const line = hunk.lines[index];
      if (line.type === 'context') {
        replacement.push(line.text);
        continue;
      }

      const block = [];
      while (index < hunk.lines.length && hunk.lines[index].type !== 'context') {
        block.push(hunk.lines[index]);
        index += 1;
      }
      index -= 1;

      const removes = block.filter((entry) => entry.type === 'remove');
      const adds = block.filter((entry) => entry.type === 'add');
      const longest = Math.max(removes.length, adds.length);

      for (let pairIndex = 0; pairIndex < longest; pairIndex += 1) {
        const removeLine = removes[pairIndex];
        const addLine = adds[pairIndex];
        const removeSelected = removeLine ? selected.has(removeLine.id) : false;
        const addSelected = addLine ? selected.has(addLine.id) : false;

        if (removeLine && addLine) {
          if (removeSelected && addSelected) {
            replacement.push(addLine.text);
          } else if (!removeSelected && !addSelected) {
            replacement.push(removeLine.text);
          } else if (!removeSelected && addSelected) {
            replacement.push(removeLine.text, addLine.text);
          }
        } else if (removeLine && !removeSelected) {
          replacement.push(removeLine.text);
        } else if (addLine && addSelected) {
          replacement.push(addLine.text);
        }
      }
    }

    const oldLineCount = hunk.lines.filter((line) => line.type !== 'add').length;
    result.splice(Math.max(0, hunk.oldStart - 1), oldLineCount, ...replacement);
  });

  return result.join('\n');
};
