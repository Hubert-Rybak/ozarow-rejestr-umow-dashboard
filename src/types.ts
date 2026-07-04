export type ContractParty = {
  kraj?: string | null;
  rodzaj?: string | null;
  nazwa?: string | null;
  nip?: string | null;
  regon?: string | null;
  imie?: string | null;
  nazwisko?: string | null;
  czyKonsorcjum?: boolean | null;
  daneAdresowe?: {
    ulica?: string | null;
    numerNieruchomosci?: string | null;
    numerLokalu?: string | null;
    wojewodztwo?: string | null;
    powiat?: string | null;
    gminaMiastoDzielnica?: string | null;
    miejscowosc?: string | null;
    kodPocztowy?: string | null;
  } | null;
};

export type AgreementDetails = {
  numerUmowy?: string | null;
  okres?: string | null;
  dataPublikacji?: string | null;
  dataModyfikacji?: string | null;
  finansowanaZeSrodkow?: boolean | null;
};

export type Agreement = {
  idUmowy: string;
  nazwa?: string;
  regon?: string;
  dataZawarciaUmowy?: string | null;
  dataZakonczeniaUmowy?: string | null;
  wartoscPrzedmiotuUmowy?: number | null;
  przedmiotUmowy?: string;
  statusUmowy?: string;
  category?: string;
  sourceUrl?: string;
  contractors?: ContractParty[];
  procurers?: ContractParty[];
  details?: AgreementDetails;
};

export type AgreementsPayload = {
  fetchedAt: string;
  source: string;
  filter: unknown;
  totalElements: number;
  totalVisibleElements: number;
  agreements: Agreement[];
};
