import { useCallback } from 'react';
import { joinNavigatorPath } from '../utils/navigatorPaths';

const useExplorerItemActions = ({
  createNewItem,
  renameItem,
  moveItem,
  deleteItem,
  syncNavigatorReferences,
  removeNavigatorReferences
}) => {
  const handleExplorerCreateItem = useCallback(async (type, itemName, parentPath = '') => {
    const requestedPath = parentPath ? joinNavigatorPath(parentPath, itemName, parentPath) : itemName;
    return createNewItem(type, requestedPath);
  }, [createNewItem]);

  const handleExplorerRenameItem = useCallback(async (itemPath, nextPath, itemType) => {
    const result = await renameItem(itemPath, nextPath, itemType);
    if (result?.success) {
      syncNavigatorReferences(itemPath, nextPath);
    }
    return result;
  }, [renameItem, syncNavigatorReferences]);

  const handleExplorerMoveItem = useCallback(async (itemPath, nextPath, itemType) => {
    const result = await moveItem(itemPath, nextPath, itemType);
    if (result?.success) {
      syncNavigatorReferences(itemPath, nextPath);
    }
    return result;
  }, [moveItem, syncNavigatorReferences]);

  const handleExplorerDeleteItem = useCallback(async (itemPath, itemType) => {
    const result = await deleteItem(itemPath, itemType);
    if (result?.success) {
      removeNavigatorReferences(itemPath);
    }
    return result;
  }, [deleteItem, removeNavigatorReferences]);

  return {
    handleExplorerCreateItem,
    handleExplorerRenameItem,
    handleExplorerMoveItem,
    handleExplorerDeleteItem
  };
};

export default useExplorerItemActions;
