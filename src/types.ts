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
};

export type AgreementsPayload = {
  fetchedAt: string;
  source: string;
  filter: unknown;
  totalElements: number;
  totalVisibleElements: number;
  agreements: Agreement[];
};
