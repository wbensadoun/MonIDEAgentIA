const pptxgen = require('pptxgenjs');

// Create a new Presentation
let pres = new pptxgen();
pres.author = 'Code Companion';
pres.company = 'Code Companion';
pres.revision = '1';
pres.subject = 'Pitch Deck';
pres.title = 'Code Companion - Pitch Deck';
pres.layout = 'LAYOUT_16x9';

// Define master slide with a background and logo placeholder
pres.defineSlideMaster({
    title: 'MASTER_SLIDE',
    background: { color: '0A192F' }, // Dark blue/gray background
    objects: [
        { text: { text: "Code Companion", options: { x: 0.5, y: 0.3, w: 3, h: 0.5, color: '64FFDA', fontSize: 18, bold: true, fontFace: 'Arial' } } },
        { line: { x: 0.5, y: 0.8, w: '93%', h: 0, line: { color: '233554', width: 2 } } }
    ]
});

// SLIDE 1: Title
let slide1 = pres.addSlide({ masterName: 'MASTER_SLIDE' });
slide1.addText('🚀 Code Companion', {
    x: '10%', y: '30%', w: '80%', color: 'FFFFFF', fontSize: 44, bold: true, align: 'center'
});
slide1.addText("L'IDE qui ne se contente pas de coder, il exécute.", {
    x: '5%', y: '50%', w: '90%', color: 'CCD6F6', fontSize: 24, align: 'center'
});
slide1.addText("La première plateforme hybride réunissant un Éditeur de Code IA, des Agents Autonomes et des Workflows Visuels.", {
    x: '5%', y: '70%', w: '90%', color: '8892B0', fontSize: 18, align: 'center'
});

// SLIDE 2: Le Problème
let slide2 = pres.addSlide({ masterName: 'MASTER_SLIDE' });
slide2.addText('❌ Le Problème du Marché Actuel', { x: 0.5, y: 1.0, w: '90%', color: 'FFFFFF', fontSize: 32, bold: true });
slide2.addText('Les développeurs perdent un temps infini à jongler entre des outils déconnectés.', { x: 0.5, y: 1.8, w: '90%', color: 'CCD6F6', fontSize: 20 });
slide2.addText([
    { text: "• Les IDE classiques (VS Code, IntelliJ) sont passifs.", options: { bullet: true } },
    { text: "• Les IDE IA de 1ère génération (Cursor, Copilot) génèrent du texte mais n'exécutent pas.", options: { bullet: true } },
    { text: "• Les outils d'automatisation (n8n, Zapier) sont déconnectés du code source.", options: { bullet: true } }
], { x: 0.5, y: 2.5, w: '90%', color: '8892B0', fontSize: 18, lineSpacing: 35 });
slide2.addText("Résultat : Charge mentale énorme et coûts d'intégration prohibitifs.", { x: 0.5, y: 4.5, w: '90%', color: 'FF6B6B', fontSize: 20, bold: true });

// SLIDE 3: La Révolution
let slide3 = pres.addSlide({ masterName: 'MASTER_SLIDE' });
slide3.addText('✅ La Révolution : Code Companion', { x: 0.5, y: 1.0, w: '90%', color: 'FFFFFF', fontSize: 32, bold: true });
slide3.addText('Une fusion inédite entre un IDE et une plateforme Multi-Agents.', { x: 0.5, y: 1.8, w: '90%', color: 'CCD6F6', fontSize: 20 });
slide3.addText([
    { text: "1. 🤖 Agents Autonomes : Terminaux intelligents qui se corrigent seuls (ReAct).", options: { breakLine: true } },
    { text: "2. 🧩 Workflows Visuels : Automatisation Drag&Drop (CI/CD, Analyse) sans quitter le code.", options: { breakLine: true } },
    { text: "3. 🌐 Hybride & Local-First : Confidentialité locale (Ollama) + Stratégie Cloud (Gemini/Claude).", options: { breakLine: true } }
], { x: 0.5, y: 2.5, w: '90%', color: '8892B0', fontSize: 18, lineSpacing: 40 });

// SLIDE 4: Comparaison
let slide4 = pres.addSlide({ masterName: 'MASTER_SLIDE' });
slide4.addText('📊 Comparaison avec la Concurrence', { x: 0.5, y: 1.0, w: '90%', color: 'FFFFFF', fontSize: 32, bold: true });
let rows = [
    [
        { text: 'Fonctionnalité', options: { fill: '233554', color: '64FFDA', bold: true } },
        { text: 'VS Code', options: { fill: '233554', color: '64FFDA', bold: true } },
        { text: 'Cursor', options: { fill: '233554', color: '64FFDA', bold: true } },
        { text: 'Devin', options: { fill: '233554', color: '64FFDA', bold: true } },
        { text: 'Code Companion', options: { fill: '233554', color: '64FFDA', bold: true } }
    ],
    ['Éditeur natif', '✅', '✅', '❌', '✅'],
    ['Auto-complétion IA', '❌', '✅', '✅', '✅'],
    ['Terminaux Autonomes', '❌', '❌', '✅', '✅'],
    ['Workflows Drag&Drop', '❌', '❌', '❌', '✅'],
    ['Catalogue n8n inclus', '❌', '❌', '❌', '✅'],
    ['Local-First / Privacy', '✅', '❌', '❌', '✅']
];
slide4.addTable(rows, { x: 0.5, y: 1.8, w: 9.0, fill: '112240', color: 'CCD6F6', fontSize: 14, border: { type: 'solid', color: '233554' }, align: 'center', colW: [2.6, 1.6, 1.6, 1.6, 1.6] });

// SLIDE 5: Architecture
let slide5 = pres.addSlide({ masterName: 'MASTER_SLIDE' });
slide5.addText('⚙️ Architecture Hybride', { x: 0.5, y: 1.0, w: '90%', color: 'FFFFFF', fontSize: 32, bold: true });
slide5.addText('Conçue pour la résilience, la vitesse et la Privacy By Design.', { x: 0.5, y: 1.8, w: '90%', color: 'CCD6F6', fontSize: 20 });
// Add some shapes to mimick the diagram
slide5.addShape(pres.ShapeType.rect, { x: 1, y: 2.5, w: 3, h: 1, fill: '112240', border: { color: '64FFDA' }, align: 'center' });
slide5.addText('Agent Cloud Premium\n(Gemini 2.5 Pro)', { x: 1, y: 2.5, w: 3, h: 1, color: 'FFFFFF', align: 'center', fontSize: 16 });

slide5.addShape(pres.ShapeType.rect, { x: 5.5, y: 2.5, w: 3, h: 1, fill: '112240', border: { color: '64FFDA' }, align: 'center' });
slide5.addText('Agent Local Privé\n(Ollama / Llama 3)', { x: 5.5, y: 2.5, w: 3, h: 1, color: 'FFFFFF', align: 'center', fontSize: 16 });

slide5.addShape(pres.ShapeType.rect, { x: 3.25, y: 4, w: 3, h: 1, fill: '112240', border: { color: '64FFDA' }, align: 'center' });
slide5.addText('Moteur de Workflows\n(n8n compatible)', { x: 3.25, y: 4, w: 3, h: 1, color: 'FFFFFF', align: 'center', fontSize: 16 });

// SLIDE 6: ROI
let slide6 = pres.addSlide({ masterName: 'MASTER_SLIDE' });
slide6.addText('📈 Projections & ROI', { x: 0.5, y: 1.0, w: '90%', color: 'FFFFFF', fontSize: 32, bold: true });
slide6.addText('💰 Le ROI chiffré (Équipe de 5 devs) :', { x: 0.5, y: 1.8, w: '90%', color: '64FFDA', fontSize: 22, bold: true });
slide6.addText([
    { text: "• Gain de temps : ~15h/semaine par développeur.", options: { bullet: true } },
    { text: "• Économie annuelle estimée : +60 000 € (Fusion de Zapier, Cursor, Copilot).", options: { bullet: true } },
    { text: "• Temps de déploiement : Divisé par 3.", options: { bullet: true } }
], { x: 0.5, y: 2.5, w: '90%', color: '8892B0', fontSize: 20, lineSpacing: 40 });

// SLIDE 7: Offre
let slide7 = pres.addSlide({ masterName: 'MASTER_SLIDE' });
slide7.addText('🛒 Offre Commerciale (SaaS Clé en Main)', { x: 0.5, y: 1.0, w: '90%', color: 'FFFFFF', fontSize: 32, bold: true });
let pricing = [
    [
        { text: 'Piliers', options: { fill: '233554', color: '64FFDA', bold: true } },
        { text: 'Tier "Pro"', options: { fill: '233554', color: '64FFDA', bold: true } },
        { text: 'Tier "Entreprise"', options: { fill: '233554', color: '64FFDA', bold: true } }
    ],
    ['Cible', 'Freelances, Startups', 'Grands Comptes, ESN'],
    ['Hébergement IA', 'Cloud Sécurisé Mutualisé', 'Dédié (VPC) ou On-Premise'],
    ['Confidentialité', 'Zero Data Retention', 'Local-First Ollama Exclusif'],
    ['Workflows', 'Illimités', 'Illimités + Partagés'],
    ['Prix', '29€ / mois / util.', '49€ / mois / util.']
];
slide7.addTable(pricing, { x: 0.5, y: 1.8, w: 9.0, fill: '112240', color: 'CCD6F6', fontSize: 16, border: { type: 'solid', color: '233554' }, align: 'left', colW: [3, 3, 3] });
slide7.addText("🚀 Prêt à transformer votre façon de développer ? contact@monideagentia.com", { x: 0.5, y: 4.8, w: '90%', color: '64FFDA', fontSize: 18, bold: true, align: 'center' });

// Save the Presentation
pres.writeFile({ fileName: 'presentation_pitch.pptx' }).then(fileName => {
    console.log(`Fichier généré : ${fileName}`);
}).catch(err => {
    console.error(`Erreur de génération: ${err}`);
});
