# AUDIT WEBDESIGN COMPLET — 120+ Questions Génériques

## Principes généraux
1. Tous les éléments ont-ils un contraste suffisant (WCAG AA minimum 4.5:1) ?
2. Y a-t-il une cohérence de spacing (8px grid system) partout ?
3. Les bordures sont-elles nécessaires ou peuvent-elles être supprimées ?
4. Y a-t-il trop de séparateurs visuels (traits, lignes) ?
5. Les boutons ont-ils des états clairs (normal, hover, active, disabled) ?
6. Les couleurs sont-elles thématisées ou hardcodées ?
7. La typographie a-t-elle une hiérarchie claire (H1 > H2 > body) ?
8. Les espacements verticaux et horizontaux sont-ils symétriques ?
9. Y a-t-il de l'"action at a distance" (une action affecte des zones éloignées) ?
10. Les icônes et textes sont-ils alignés visuellement ?

---

## TOPBAR (En haut)

### Structure & Layout
11. La topbar est-elle trop chargée (nombre de boutons/contrôles) ?
12. Y a-t-il de la hiérarchie visuelle claire dans la topbar ?
13. Le logo FuturIA a-t-il besoin d'être aussi gros ?
14. Le projet chip "Aucun projet" ajoute-t-il de la valeur ou du bruit ?
15. Le séparateur "|" est-il vraiment nécessaire ou peut-on l'enlever ?
16. La topbar s'adapte-t-elle bien en 1280px ? En 1920px ? En 768px ?
17. Y a-t-il trop de spacing horizontal entre les éléments ?
18. Les groupes de boutons sont-ils visuellement séparés ou fusionnés ?

### Sélecteurs & Contrôles
19. Le sélecteur de provider/modèle est-il un select unique ou 2 contrôles séparés ?
20. Pourquoi ne pas avoir un popover au lieu d'un select pour plus de clarté ?
21. Le label "Gemini · gemini-3-1-pro-preview" est-il assez lisible ?
22. L'icône Auto-Route (⚡) est-elle claire ou confuse ?
23. Le badge "Auto-Route" en couleur accent attire-t-il trop l'attention ?
24. Y a-t-il une feedback visuelle quand on clique sur Auto-Route ?

### Couleurs & Contraste
25. La couleur de la topbar (dark) crée-t-elle assez de contraste avec le contenu ?
26. Les icônes sont-elles suffisamment visibles en theme clair ?
27. Les text-dim et text-muted sont-ils assez contrastés ?

### Actions & Menu
28. Les actions droite (thème, workflows, settings) sont-elles regroupées logiquement ?
29. Y a-t-il trop de boutons "action" qui pourraient être dans un menu "..." ?
30. Le bouton "Settings" a-t-il besoin d'une label ou juste l'icône ?

---

## SIDEBAR GAUCHE (Projets)

31. Le titre "ESPACES DE TRAVAIL · 0" est-il utile ?
32. Le bouton "+ Ouvrir un projet" est-il assez visible/cliquable ?
33. L'espace vide quand aucun projet n'est ouvert — c'est du vide perdu ou ok ?
34. Y a-t-il de la hiérarchie entre "Aucun projet ouvert" et le bouton ?
35. Le sidebar collapsable fonctionne-t-il bien visuellement ?
36. Y a-t-il assez de contraste texte sur fond sidebar ?
37. Les items de la liste projets ont-ils un hover state clair ?
38. La width du sidebar — c'est optimal ou trop large/petit ?

---

## ZONE CHAT PRINCIPALE

### Conteneur général
39. Le chat remplit-il bien l'espace ou y a-t-il des marges inutiles ?
40. Y a-t-il assez de padding interne ou c'est trop serré ?
41. Les messages et l'input sont-ils visuellement séparés ?
42. Le fond du chat container — c'est trop dark/light ?

### Espace messages vide
43. Le texte "Commencez à discuter avec l'IA" a-t-il besoin de l'emoji ou du texte ?
44. Le sous-texte gris est-il utile ou du bruit ?
45. L'espace vide quand aucun message — c'est une bonne affordance de clic ?
46. Y a-t-il un state "loading" clair visuellement ?

### Barre de contexte (Contexte | Prompt | Tokens | Coût)
47. Ces 4 métriques sont-elles essentielles en vue chat ou peut-on les mettre ailleurs ?
48. La barre de métriques — elle prend trop d'espace ?
49. Y a-t-il une hiérarchie entre contexte/prompt/tokens/coût ?
50. Utiliser des icônes au lieu de texte pour économiser l'espace ?
51. Le layout horizontal — c'est optimal ou mieux en vertical sur mobile ?
52. Faut-il une bordure/séparation entre cette barre et les messages ?

### Zone input (textarea)
53. Le placeholder "Votre requête..." est-il clair ?
54. La hauteur du textarea — c'est optimal pour taper ?
55. Y a-t-il assez de visual feedback quand on focus (glow, border color) ?
56. Les boutons "+" et autres outils à côté du textarea — sont-ils bien placés ?
57. Pourrait-on avoir un expand/collapse de l'input sur focus ?
58. Le bouton "Envoyer" est-il trop gros ou bien proportionné ?

### Rangée des contrôles (Agent, Modèle, Autonomie, Envoyer)
59. Cette rangée — elle devrait être en bas du chat ou ailleurs ?
60. Les 4 éléments (agent, modèle, autonomie, envoyer) sont-ils alignés ?
61. Y a-t-il trop de padding/gap entre ces éléments ?
62. Les pills (Agent, Gemini, Autonome) — c'est la bonne forme ou rectangles ?
63. Pourrait-on avoir juste des icônes au lieu de texte + icônes ?
64. Le bouton "Envoyer" — c'est bleu accent ou couleur du thème ?
65. Y a-t-il un state "disabled" clair quand on ne peut pas envoyer ?

### Popover Menu "Plus d'options"
66. Le popover s'ouvre-t-il au bon endroit (ne cache pas le contenu) ?
67. Y a-t-il assez de padding/spacing à l'intérieur du popover ?
68. Les items du menu — sont-ils cliquables avec assez de padding ?
69. La position du popover permet-elle de voir le chat derrière ?

---

## DIALOGS & MODALS

### Modal "Paramètres" (Settings)
70. La modal prend-elle trop/peu d'espace (max-width) ?
71. Y a-t-il un close button visible (X) ?
72. Les onglets (Modèles cloud, Ollama, etc.) — c'est bien structuré ?
73. Faut-il une barre de scroll pour la modal ou elle reste courte ?
74. Le backdrop (fond grisé derrière) — c'est suffisant ou pas assez opaque ?

---

## GAMEWORLD / AGENTS

75. La zone Agents a-t-elle un layout clair et pas confus ?
76. Les agents affichés — c'est en liste, grille, ou autre ?
77. Y a-t-il trop d'informations par agent ou c'est minimaliste ?
78. Les sélecteur de thème (town, cyberpunk, etc.) — sont-ils visibles et cliquables ?
79. Les thèmes actuels — sont-ils vraiment différents visuellement ou juste des couleurs ?

---

## COULEURS & THÉMATISATION

80. Combien de thèmes y a-t-il ? (4, 5, 10+)
81. Chaque thème a-t-il au minimum 3-4 couleurs distinctes ou c'est monochrome ?
82. Y a-t-il une palette cohérente (primaire, accent, danger, success) par thème ?
83. Les thèmes contrastent-ils bien entre eux visuellement ?
84. La couleur "accent" du thème — elle s'utilise où (buttons, links, highlights) ?
85. Y a-t-il une couleur "background", "surface", "surface-2" clairement différentes ?
86. Les couleurs de texte (text-main, text-dim, text-muted) — c'est 3 niveaux de contraste ?
87. Y a-t-il une couleur "danger" (rouge) pour les actions destructrices ?
88. Y a-t-il une couleur "success" (vert) pour les actions complétées ?

---

## BORDURES & TRAITS

89. Toutes les bordures sont-elles nécessaires ou peut-on en supprimer 50% ?
90. Y a-t-il une épaisseur de bordure cohérente (1px, 2px, etc.) ?
91. Les bordures sont-elles arrondies (radius) ou carrées ?
92. Y a-t-il trop de traits horizontaux/verticaux qui divisent les zones ?
93. Faut-il remplacer les bordures par des ombres subtiles (shadows) ?
94. Les cards (si y en a) — elles ont une bordure ou juste une ombre ?

---

## BOUTONS & INTERACTIONS

95. Y a-t-il une taille de bouton cohérente (small, medium, large) ?
96. Tous les boutons cliquables ont-ils un cursor pointer clair ?
97. Y a-t-il un hover state visible (couleur change, ombre, scale) ?
98. Y a-t-il un active state distinct du hover ?
99. Les boutons disabled sont-ils clairement disable (opacity, grayscale, etc.) ?
100. Y a-t-il des boutons "primary" (accent), "secondary" (outline), "ghost" distincts ?
101. Les boutons "danger" (red) sont-ils clairement identifiables ?
102. Le spacing à l'intérieur des boutons (padding) — c'est cohérent ?
103. Y a-t-il trop de boutons par zone ou une densité ok ?

---

## SPACING & LAYOUT

104. Y a-t-il une grid cohérente (8px, 4px) ou du spacing aléatoire ?
105. Les margins extérieures des containers — c'est symétrique ?
106. Y a-t-il un max-width limité pour la lisiblité (max 80-120 chars pour du texte) ?
107. Les espacements entre sections — c'est assez grand ou trop compact ?
108. Le gap entre boutons/éléments — c'est cohérent partout ?
109. Y a-t-il du padding inutile qui perd de l'espace ?

---

## RESPONSIVE & ADAPTABILITÉ

110. L'app s'affiche bien en 1280px ? 1920px ? 768px (tablet) ? 375px (mobile) ?
111. Les éléments se réajustent-ils bien à l'étroiteur ou cassent-ils ?
112. Le topbar — reste-t-elle une ligne ou se transforme-t-elle sur mobile ?
113. Le sidebar — peut-on le collapse sur mobile ?
114. Le chat — il s'adapte bien à mobile ou c'est illisible ?
115. Y a-t-il assez de touch targets (min 44x44px) pour mobile ?

---

## ACCESSIBILITÉ

116. Tous les boutons/contrôles ont-ils des labels accessibles (aria-label) ?
117. Y a-t-il une order de tab cohérente (tabindex) ?
118. Les couleurs seules ne sont pas l'unique indicator (ex: "error = red + icon") ?
119. Le contraste de couleurs — c'est WCAG AA au minimum (4.5:1) ?
120. Les icônes seules ont-elles du texte alt ou un label ?

---

## BONUS QUESTIONS

121. Quel est le KPI principal de cette UI ? (rapidité du chat ? visibility des agents ?)
122. Si tu devais supprimer UN élément, lequel ?
123. Si tu devais ajouter UNE feature de design, ce serait quoi ?
124. Y a-t-il une cohérence entre "modern" et "playful" ou ça mélange trop les styles ?
