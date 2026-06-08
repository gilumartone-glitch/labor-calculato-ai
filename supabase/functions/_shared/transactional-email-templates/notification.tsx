import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

export interface NotificationEmailProps {
  recipientName?: string
  title?: string
  message?: string
  ctaLabel?: string
  ctaUrl?: string
  footerNote?: string
  unsubscribeUrl?: string
}

export const NotificationEmail = ({
  recipientName,
  title = 'Aggiornamento dal tuo workspace',
  message = 'Hai un nuovo aggiornamento.',
  ctaLabel,
  ctaUrl,
  footerNote,
  unsubscribeUrl,
}: NotificationEmailProps) => (
  <Html>
    <Head />
    <Preview>{title}</Preview>
    <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Inter, Arial, sans-serif', margin: 0, padding: '24px 0' }}>
      <Container style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: '32px', maxWidth: 560, margin: '0 auto', border: '1px solid #e4e4e7' }}>
        <Section>
          <Text style={{ color: '#71717a', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', margin: 0 }}>Tecnofra Lab</Text>
          <Heading style={{ color: '#18181b', fontSize: 22, marginTop: 8, marginBottom: 16 }}>{title}</Heading>
          {recipientName && (
            <Text style={{ color: '#3f3f46', fontSize: 15, margin: '0 0 12px' }}>Ciao {recipientName},</Text>
          )}
          <Text style={{ color: '#3f3f46', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '0 0 20px' }}>{message}</Text>
          {ctaUrl && ctaLabel && (
            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Link
                href={ctaUrl}
                style={{
                  backgroundColor: '#18181b',
                  color: '#ffffff',
                  padding: '12px 22px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                  display: 'inline-block',
                }}
              >
                {ctaLabel}
              </Link>
            </Section>
          )}
          {footerNote && (
            <Text style={{ color: '#71717a', fontSize: 13, margin: '16px 0 0' }}>{footerNote}</Text>
          )}
        </Section>
        <Section style={{ marginTop: 32, borderTop: '1px solid #e4e4e7', paddingTop: 16 }}>
          <Text style={{ color: '#a1a1aa', fontSize: 12, margin: 0 }}>
            Questa email è inviata da Tecnofra Lab tramite flow.tecnofra.it.
          </Text>
          {unsubscribeUrl && (
            <Text style={{ color: '#a1a1aa', fontSize: 12, margin: '6px 0 0' }}>
              <Link href={unsubscribeUrl} style={{ color: '#71717a' }}>Annulla iscrizione</Link>
            </Text>
          )}
        </Section>
      </Container>
    </Body>
  </Html>
)

export default NotificationEmail

import type { TemplateEntry } from './registry.ts'

export const template = {
  component: NotificationEmail,
  displayName: 'Notifica generica',
  subject: (data: NotificationEmailProps) => data.title || 'Aggiornamento dal tuo workspace',
  previewData: {
    recipientName: 'Mario',
    title: 'Nuovo sub-ordine assegnato',
    message: 'Ti è stato assegnato un nuovo sub-ordine in falegnameria.\nCommessa: C-2026-001\nScadenza: 15/06/2026',
    ctaLabel: 'Apri produzione',
    ctaUrl: 'https://flow.tecnofra.it/produzione',
    footerNote: 'Riceverai una notifica anche nell\'app.',
  } satisfies NotificationEmailProps,
} satisfies TemplateEntry
