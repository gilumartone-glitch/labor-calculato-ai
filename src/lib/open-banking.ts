export type BankingBank = "Credem" | "BNL";
export type BankingAssessment = {
  bank: BankingBank;
  provider: "Enable Banking";
  checkedAt: string;
  compatibilityVerified: boolean;
  productionReady: boolean;
  costsConfirmed: boolean;
  monthlyCostEur: number | null;
  consentExpiresAt: string | null;
  consentGranted: boolean;
  syncFrequencyConfirmed: boolean;
  blockers: string[];
};

// Only server-verified evidence can satisfy these gates; UI acknowledgements cannot.
export function canActivateBankSync(assessment: BankingAssessment, now = Date.now()): boolean {
  return assessment.compatibilityVerified && assessment.productionReady && assessment.costsConfirmed
    && assessment.monthlyCostEur !== null && Number.isFinite(assessment.monthlyCostEur) && assessment.monthlyCostEur >= 0
    && assessment.consentGranted && !!assessment.consentExpiresAt && Date.parse(assessment.consentExpiresAt) > now
    && assessment.syncFrequencyConfirmed && assessment.blockers.length === 0;
}

export function providerInquiry(bank: BankingBank, product: string): string {
  return `Richiesta di attivazione Enable Banking per Tecnofra: banca ${bank}, accesso ${product.trim()}. Confermate il supporto di questo specifico conto aziendale in Italia e il relativo connettore? Richiediamo solo lettura di saldi e movimenti, nessuna disposizione di pagamento. Indicate preventivo in EUR (canone minimo, costo per conto, avviamento, IVA e limiti), contratto e KYB, frequenza degli aggiornamenti, durata del consenso e modalità di rinnovo, eventuali limiti allo storico. Nessuna sincronizzazione sarà attivata prima delle conferme e dell'autorizzazione bancaria.`;
}