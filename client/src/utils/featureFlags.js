/**
 * Drapeaux de fonctionnalite lus a l'execution.
 *
 * 1.4c. Le swap de la liste de messages d'AIChat vers MessageViewer touche la
 * surface la plus visible de l'application ; il est donc livre eteint et
 * activable sans rebuild via localStorage, pour qu'un retour arriere ne
 * demande pas un redeploiement :
 *
 *     localStorage.setItem('cc.flag.chatInterfaceSwap', '1')   // activer
 *     localStorage.removeItem('cc.flag.chatInterfaceSwap')     // revenir
 *
 * Un build peut aussi le forcer via REACT_APP_CHAT_INTERFACE_SWAP=1.
 * Les criteres d'abandon sont documentes dans docs/1.4c-swap-garde.md.
 */
export const FLAG_PREFIX = 'cc.flag.';

export const isFlagEnabled = (name, envValue) => {
  if (envValue === '1' || envValue === 'true') return true;
  try {
    // localStorage est absent en SSR et peut lever si le stockage est
    // desactive par la politique du navigateur : un drapeau ne doit jamais
    // faire tomber l'application.
    return window.localStorage.getItem(`${FLAG_PREFIX}${name}`) === '1';
  } catch {
    return false;
  }
};

export const isChatInterfaceSwapEnabled = () =>
  isFlagEnabled('chatInterfaceSwap', process.env.REACT_APP_CHAT_INTERFACE_SWAP);
