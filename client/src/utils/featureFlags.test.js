import { isChatInterfaceSwapEnabled, isFlagEnabled } from './featureFlags';

describe('isFlagEnabled', () => {
  afterEach(() => window.localStorage.clear());

  test('la variable de build gagne, sans toucher au stockage', () => {
    expect(isFlagEnabled('x', '1')).toBe(true);
    expect(isFlagEnabled('x', 'true')).toBe(true);
  });

  test('lit le drapeau depuis localStorage avec le prefixe attendu', () => {
    window.localStorage.setItem('cc.flag.x', '1');
    expect(isFlagEnabled('x')).toBe(true);
  });

  test('toute autre valeur vaut desactive', () => {
    window.localStorage.setItem('cc.flag.x', '0');
    expect(isFlagEnabled('x')).toBe(false);
    expect(isFlagEnabled('inconnu')).toBe(false);
    expect(isFlagEnabled('x', '0')).toBe(false);
  });

  test('un stockage inaccessible ne fait pas tomber l\'application', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled by policy');
    });
    expect(isFlagEnabled('x')).toBe(false);
    getItem.mockRestore();
  });
});

describe('isChatInterfaceSwapEnabled', () => {
  afterEach(() => window.localStorage.clear());

  test('eteint par defaut — le swap 1.4c est livre inactif', () => {
    expect(isChatInterfaceSwapEnabled()).toBe(false);
  });

  test('activable a chaud sans rebuild', () => {
    window.localStorage.setItem('cc.flag.chatInterfaceSwap', '1');
    expect(isChatInterfaceSwapEnabled()).toBe(true);
  });
});
