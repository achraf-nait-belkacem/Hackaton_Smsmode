import { SmsmodeRcsClient } from '@smsmode/rcs';
import { requireRcsCallbackUrl } from '../config.js';
import { setLocationPending } from './sessions.js';
import { ClientLocation, extractClientLocation } from './payload.js';

type LocationState = 'idle' | 'awaiting_location' | 'route_sent';

export class MapAssistant {
    isA2P: boolean;
    phoneNb: string;
    client: SmsmodeRcsClient;
    private companyName: string;
    private companyDestination: string;
    private state: LocationState = 'idle';

    constructor(isA2P: boolean, phoneNb: string, client: SmsmodeRcsClient, companyName?: string, companyDestination?: string, awaitingLocation = false) {
        this.isA2P = isA2P;
        this.phoneNb = phoneNb;
        this.client = client;
        this.companyName = companyName || 'notre entreprise';
        this.companyDestination = companyDestination || this.companyName;
        this.state = awaitingLocation ? 'awaiting_location' : 'idle';
    }

    async askForLocation() {
        const callbackUrlMo = requireRcsCallbackUrl();
        await this.client.send({
            recipient: { to: this.phoneNb },
            callbackUrlMo,
            body: {
                type: 'TEXT' as const,
                text: 'Pour vous envoyer le trajet, partagez votre position actuelle.',
                suggestions: [
                    {
                        type: 'REQUEST_LOCATION' as const,
                        text: 'Partager ma position',
                        postbackData: 'request_location'
                    }
                ]
            }
        });

        this.state = 'awaiting_location';
        await setLocationPending(this.phoneNb, true);
        console.log('Demande de position envoyee ✅');
    }

    async waitForLocationResponse(payload: unknown) {
        if (this.state !== 'awaiting_location') {
            return false;
        }

        const clientLocation = extractClientLocation(payload);

        if (!clientLocation) {
            await this.sendLocationReminder();
            return true;
        }

        await this.sendRouteToCompany(clientLocation);
        this.state = 'route_sent';
        return true;
    }

    private buildRouteUrl(clientLocation: ClientLocation) {
        const url = new URL('https://www.google.com/maps/dir/');
        url.searchParams.set('api', '1');
        url.searchParams.set('origin', `${clientLocation.latitude},${clientLocation.longitude}`);
        url.searchParams.set('destination', this.companyDestination);
        url.searchParams.set('travelmode', 'driving');
        return url.toString();
    }

    private async sendRouteToCompany(clientLocation: ClientLocation) {
        const routeUrl = this.buildRouteUrl(clientLocation);
        const callbackUrlMo = requireRcsCallbackUrl();

        await this.client.send({
            recipient: { to: this.phoneNb },
            callbackUrlMo,
            body: {
                type: 'TEXT' as const,
                text: `Votre trajet vers ${this.companyName} est pret. Ouvrez la carte pour demarrer l'itineraire.`,
                suggestions: [
                    {
                        type: 'OPEN_URL' as const,
                        text: 'Ouvrir la carte',
                        postbackData: 'open_route_map',
                        url: routeUrl,
                        webviewSize: 'FULL'
                    }
                ]
            }
        });

        await setLocationPending(this.phoneNb, false);
        console.log('Itineraire envoye ✅');
    }

    private async sendLocationReminder() {
        const callbackUrlMo = requireRcsCallbackUrl();
        await this.client.send({
            recipient: { to: this.phoneNb },
            callbackUrlMo,
            body: {
                type: 'TEXT' as const,
                text: 'Je n\'ai pas encore recu votre position. Pouvez-vous la partager pour generer le trajet ?',
                suggestions: [
                    {
                        type: 'REQUEST_LOCATION' as const,
                        text: 'Partager ma position',
                        postbackData: 'request_location'
                    }
                ]
            }
        });

        console.log('Rappel de position envoye ✅');
    }
}