# Task 12 — formats.result race

- La requête active `formats.list` est désormais seule sur le fil WebSocket.
- Une nouvelle requête annule son waiter précédent et attend que la réponse obsolète (ou son délai) soit consommée avant l'envoi suivant.
- Le démarrage différé du waiter suivant empêche la même itération de dispatch WebSocket de lui livrer la réponse obsolète.
- Régression couverte par `apps/extension/src/popup-handlers.test.ts`; le téléchargement conserve l'URL du `tab` affiché par l'état de l'application.
