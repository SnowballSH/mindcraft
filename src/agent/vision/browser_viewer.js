import settings from '../settings.js';

export function addBrowserViewer(bot, count_id) {
    if (!settings.render_bot_view) return;

    // Lazy import so environments without optional/native deps don't crash on startup.
    import('prismarine-viewer')
        .then((m) => {
            const pv = m?.default ?? m;
            const mineflayerViewer = pv.mineflayer;
            mineflayerViewer(bot, { port: 3000 + count_id, firstPerson: true });
        })
        .catch((err) => {
            console.warn('Failed to start prismarine viewer:', err?.message ?? err);
        });
}