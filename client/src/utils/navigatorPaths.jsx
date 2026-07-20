export const splitNavigatorPath = (value) => String(value || '')
  .split(/[\\/]+/)
  .map((segment) => segment.trim())
  .filter(Boolean);

export const getNavigatorSeparator = (value) => (String(value || '').includes('\\') ? '\\' : '/');

export const getNavigatorBaseName = (value) => {
  const segments = splitNavigatorPath(value);
  return segments[segments.length - 1] || '';
};

export const getNavigatorDirName = (value) => {
  const segments = splitNavigatorPath(value);
  if (segments.length <= 1) return '';
  return segments.slice(0, -1).join(getNavigatorSeparator(value));
};

export const joinNavigatorPath = (basePath, childName, separatorHint = '/') => {
  const baseSegments = splitNavigatorPath(basePath);
  const childSegments = splitNavigatorPath(childName);
  const separator = getNavigatorSeparator(basePath || separatorHint);
  return [...baseSegments, ...childSegments].join(separator);
};

export const isSameNavigatorPath = (left, right) => {
  const leftSegments = splitNavigatorPath(left);
  const rightSegments = splitNavigatorPath(right);
  if (leftSegments.length !== rightSegments.length) return false;
  return leftSegments.every((segment, index) => segment === rightSegments[index]);
};

export const isNavigatorDescendant = (candidatePath, parentPath) => {
  const candidateSegments = splitNavigatorPath(candidatePath);
  const parentSegments = splitNavigatorPath(parentPath);
  if (parentSegments.length === 0 || candidateSegments.length <= parentSegments.length) {
    return false;
  }
  return parentSegments.every((segment, index) => candidateSegments[index] === segment);
};

export const replaceNavigatorPathPrefix = (targetPath, previousPrefix, nextPrefix) => {
  const targetSegments = splitNavigatorPath(targetPath);
  const previousSegments = splitNavigatorPath(previousPrefix);
  if (previousSegments.length === 0 || previousSegments.length > targetSegments.length) {
    return targetPath;
  }

  const matches = previousSegments.every((segment, index) => targetSegments[index] === segment);
  if (!matches) return targetPath;

  const separator = getNavigatorSeparator(targetPath || nextPrefix);
  const nextSegments = splitNavigatorPath(nextPrefix);
  const finalSegments = [...nextSegments, ...targetSegments.slice(previousSegments.length)];
  return finalSegments.join(separator);
};
