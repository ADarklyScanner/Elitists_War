// Text-message alerts for online games. Players opt in with a phone number; a message goes out
// only for the few moments `service.ts` reports (game started, your turn, an Attack to Destroy on
// you), and never more than one per player every five minutes.
import type { AlertKind, Notifier } from './service';

export const SMS_COOLDOWN_MINUTES = 5;

/** Where opted-in numbers live, and the atomic "may we text this player now?" check. */
export interface SmsPrefs {
  /**
   * If the player has opted in and has not been texted within the cooldown, record that a text is
   * being sent now and return the number; otherwise return null. Must be atomic, so two moves
   * finishing together cannot both text the same player.
   */
  claim(userId: string, cooldownMinutes: number): Promise<string | null>;
}

export type SendSms = (to: string, body: string) => Promise<void>;

export function alertText(kind: AlertKind, what: string, siteUrl: string): string {
  const lead = kind === 'destroyAttack' ? 'Under attack!' : kind === 'gameStarted' ? 'Game on.' : 'Your move.';
  return `Elitists War: ${lead} ${what}. ${siteUrl} Reply STOP to opt out.`;
}

export class SmsNotifier implements Notifier {
  constructor(private prefs: SmsPrefs, private send: SendSms, private siteUrl: string) {}

  async alert(userId: string, _gameId: string, kind: AlertKind, what: string): Promise<void> {
    const phone = await this.prefs.claim(userId, SMS_COOLDOWN_MINUTES);
    if (!phone) return; // not opted in, or texted within the last five minutes
    await this.send(phone, alertText(kind, what, this.siteUrl));
  }
}

/** A sender for Twilio's REST API (Account SID, auth token, and a sending number or Messaging Service). */
export function twilioSender(accountSid: string, authToken: string, from: string): SendSms {
  return async (to, body) => {
    const form = new URLSearchParams({ To: to, Body: body });
    form.set(from.startsWith('MG') ? 'MessagingServiceSid' : 'From', from);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!res.ok) throw new Error(`SMS failed (${res.status})`);
  };
}

/** Numbers are stored in international (E.164) form, e.g. +15551234567. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** In-memory prefs for tests and local play. */
export class MemorySmsPrefs implements SmsPrefs {
  rows = new Map<string, { phone: string; optedIn: boolean; lastSent?: number }>();
  now = () => Date.now();
  async claim(userId: string, cooldownMinutes: number) {
    const r = this.rows.get(userId);
    if (!r?.optedIn) return null;
    if (r.lastSent !== undefined && this.now() - r.lastSent < cooldownMinutes * 60_000) return null;
    r.lastSent = this.now();
    return r.phone;
  }
}
