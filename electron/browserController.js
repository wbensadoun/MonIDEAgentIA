const puppeteer = require('puppeteer');

let browser = null;
let page = null;

async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true, // Peut être changé à false pour le debug
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  if (!page) {
    page = await browser.newPage();
    // Taille par défaut pour la capture d'écran
    await page.setViewport({ width: 1280, height: 800 });
  }
  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

async function navigate(url) {
  const p = await initBrowser();
  await p.goto(url, { waitUntil: 'networkidle2' });
  return await getScreenshotAndDom();
}

async function click(selector) {
  const p = await initBrowser();
  await p.waitForSelector(selector, { timeout: 5000 });
  await p.click(selector);
  // Attendre un peu après le clic pour d'éventuels re-rendus
  await new Promise(resolve => setTimeout(resolve, 1000));
  return await getScreenshotAndDom();
}

async function type(selector, text) {
  const p = await initBrowser();
  await p.waitForSelector(selector, { timeout: 5000 });
  await p.type(selector, text, { delay: 50 });
  await new Promise(resolve => setTimeout(resolve, 500));
  return await getScreenshotAndDom();
}

async function executeAction(action, options = {}) {
  try {
    switch (action) {
      case 'navigate':
        if (!options.url) throw new Error('URL manquante pour l\'action navigate');
        return await navigate(options.url);
      case 'click':
        if (!options.selector) throw new Error('Sélecteur manquant pour l\'action click');
        return await click(options.selector);
      case 'type':
        if (!options.selector || !options.text) throw new Error('Sélecteur ou texte manquant pour l\'action type');
        return await type(options.selector, options.text);
      case 'screenshot':
      case 'get_dom':
      default:
        // Par défaut, ou si explicitement demandé, on renvoie juste l'état actuel
        await initBrowser();
        return await getScreenshotAndDom();
    }
  } catch (error) {
    return {
      success: false,
      error: `Erreur Browser: ${error.message}`
    };
  }
}

async function getScreenshotAndDom() {
  const p = await initBrowser();
  
  // Prendre une capture d'écran en base64
  const screenshotBase64 = await p.screenshot({ encoding: 'base64' });
  
  // Récupérer une version simplifiée du DOM pour réduire les tokens
  const domState = await p.evaluate(() => {
    // Nettoyer un peu le DOM pour ne garder que l'essentiel
    const getSimplifiedHtml = (element) => {
      if (element.nodeType === Node.TEXT_NODE) {
        return element.textContent.trim() ? element.textContent : '';
      }
      if (element.nodeType !== Node.ELEMENT_NODE) return '';
      
      const tagName = element.tagName.toLowerCase();
      // Ignorer les scripts, styles, etc.
      if (['script', 'style', 'noscript', 'meta', 'link', 'svg', 'path'].includes(tagName)) return '';
      
      let html = `<${tagName}`;
      if (element.id) html += ` id="${element.id}"`;
      if (element.className) html += ` class="${element.className}"`;
      if (['input', 'button', 'a'].includes(tagName)) {
        if (element.type) html += ` type="${element.type}"`;
        if (element.value) html += ` value="${element.value}"`;
        if (element.name) html += ` name="${element.name}"`;
        if (element.href) html += ` href="${element.href}"`;
      }
      html += '>';
      
      let childContent = '';
      for (const child of element.childNodes) {
        childContent += getSimplifiedHtml(child);
      }
      
      html += childContent;
      html += `</${tagName}>`;
      return html;
    };
    
    return getSimplifiedHtml(document.body);
  });

  return {
    success: true,
    screenshotBase64,
    dom: domState,
    url: p.url()
  };
}

module.exports = {
  initBrowser,
  closeBrowser,
  executeAction,
  getScreenshotAndDom
};
