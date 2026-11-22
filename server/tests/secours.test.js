/* v1.2 : numéro WhatsApp de l'hôte (secours) */
const { createApp, normPhone } = require('../app');
const { memberIdFromSecret } = require('../lib/salon');
process.env.LHVC_QUIET = '1';

module.exports = ({ describe, it, expect }) => {
  describe('Secours › Numéro WhatsApp de l’hôte', () => {
    it('numéros français et internationaux normalisés, le reste refusé', () => {
      expect(normPhone('06 12 34 56 78')).toBe('33612345678');
      expect(normPhone('+33 6 12 34 56 78')).toBe('33612345678');
      expect(normPhone('0033612345678')).toBe('33612345678');
      expect(normPhone('+32 470 12 34 56')).toBe('32470123456');
      expect(normPhone('pas un numéro')).toBe('');
      expect(normPhone('12')).toBe('');
    });
    it('enregistré par l’hôte, puis transmis aux téléphones à chaque synchronisation', () => {
      const app = createApp({ pin: '482913' });
      const tok = app.route('POST', '/api/host/login', { pin: '482913' }, null, '127.0.0.1').data.token;
      app.route('POST', '/api/host/settings', { wifiSsid: '', hostWhatsapp: '06 12 34 56 78' }, tok, '127.0.0.1');
      const sec = 'secret-secours-test-0123456789';
      const r = app.route('POST', '/api/salon/sync', { member: { id: memberIdFromSecret(sec), secret: sec, name: 'Zé' }, votes: [] }, null, '192.168.1.9');
      expect(r.data.hote.whatsapp).toBe('33612345678');
      // un réglage ultérieur sans le champ ne l'efface pas
      app.route('POST', '/api/host/settings', { wifiSsid: 'Vinasse' }, tok, '127.0.0.1');
      expect(app.info().whatsapp).toBe('33612345678');
    });
  });
};
