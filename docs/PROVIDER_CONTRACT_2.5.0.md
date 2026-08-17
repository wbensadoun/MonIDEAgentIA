# Contrat backend multi-provider — 2.5.0

COD-9 introduit un contrat unique réservé au processus principal pour Gemini,
Claude, Kimi, Ollama et DashScope. Le renderer conserve son contrat actuel : il
ne reçoit ni provider, ni modèle, ni usage/coût, ni credential.

Le contrat normalise les complétions, les capacités, la santé, les erreurs,
l'annulation, les délais et les retries explicitement demandés (`retryAttempts`,
maximum 2). Une valeur de provider inconnue échoue explicitement ; seule
l'absence de provider conserve le défaut Gemini historique. Il n'existe pas de
fallback implicite depuis une valeur inconnue.

DashScope est un adaptateur de preuve côté backend. Il lit exclusivement
`DASHSCOPE_API_KEY` / `DASHSCOPE_MODEL` / `DASHSCOPE_API_URL`, ou un credential
géré injecté par le main process. Il ignore toute clé `apiKey` issue des options
IPC. Aucun smoke réel n'est inclus : fournir un secret frais hors chat est
nécessaire pour le réaliser.

Kimi et Ollama remettent leurs tokens au callback du contrat avant l'émission
IPC ; Gemini, Claude et DashScope déclarent `streaming: false` tant qu'un vrai
flux n'est pas intégré. `health` est actuellement explicitement unsupported
pour les adaptateurs de production : aucun faux probe n'est annoncé.

Les coûts restent à `null` lorsqu'un adaptateur ne retourne pas de tarif fiable;
le contrat ne déduit jamais un prix ou un nombre de tokens à partir d'un modèle
ou d'un texte. Aucun événement n'est écrit dans le ledger tant que la source
d'usage n'est pas fiable.
