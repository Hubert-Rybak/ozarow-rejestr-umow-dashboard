/**
 * Lista osób pełniących funkcje publiczne w gminie Ożarów Mazowiecki
 * oraz powiecie warszawskim zachodnim (stan na 22.08.2026).
 *
 * Źródła:
 *  - Rada Miejska i Burmistrz: https://ozarow-mazowiecki.pl/o-gminie/samorzad/rada-miejska/
 *    oraz .../burmistrz-ozarowa-mazowieckiego/
 *  - Zarząd i Rada Powiatu: https://pwz.pl/page/zarzad-powiatu-warszawskiego-zachodniego
 *    oraz https://pwz.pl/page/radni
 *
 * Lista wymaga okresowej odświeżenia (np. po wyborach samorządowych).
 */

export type OfficialBody = 'Gmina Ożarów Mazowiecki' | 'Powiat Warszawski Zachodni';

export type PublicOfficial = {
  firstName: string;
  lastName: string;
  role: string;
  body: OfficialBody;
};

export const OFFICIALS_AS_OF = '2026-08-22';

export const OFFICIALS_SOURCES = [
  'https://ozarow-mazowiecki.pl/o-gminie/samorzad/rada-miejska/',
  'https://ozarow-mazowiecki.pl/o-gminie/samorzad/burmistrz-ozarowa-mazowieckiego/',
  'https://pwz.pl/page/zarzad-powiatu-warszawskiego-zachodniego',
  'https://pwz.pl/page/radni',
];

const GMINA: OfficialBody = 'Gmina Ożarów Mazowiecki';
const POWIAT: OfficialBody = 'Powiat Warszawski Zachodni';

function official(firstName: string, lastName: string, role: string, body: OfficialBody): PublicOfficial {
  return { firstName, lastName, role, body };
}

/** Burmistrz + Rada Miejska (IX kadencji). */
const GMINA_OFFICIALS: PublicOfficial[] = [
  official('Paweł', 'Kanclerz', 'Burmistrz Ożarowa Mazowieckiego', GMINA),
  official('Andrzej', 'Cichal', 'Przewodniczący Rady Miejskiej', GMINA),
  official('Patrycja', 'Markowska', 'Wiceprzewodnicząca Rady Miejskiej', GMINA),
  official('Tadeusz', 'Szmigiel', 'Wiceprzewodniczący Rady Miejskiej', GMINA),
  official('Adrian', 'Antosiewicz', 'Radny miejski', GMINA),
  official('Anna', 'Bartoszewicz', 'Radna miejska', GMINA),
  official('Kamil', 'Bednarski', 'Radny miejski', GMINA),
  official('Natalia', 'Ciejka', 'Radna miejska', GMINA),
  official('Mariusz', 'Ilnicki', 'Radny miejski', GMINA),
  official('Iwona', 'Jabłońska', 'Radna miejska', GMINA),
  official('Anna', 'Jaroń', 'Radna miejska', GMINA),
  official('Katarzyna', 'Kędzierska', 'Radna miejska', GMINA),
  official('Marcin', 'Kózka', 'Radny miejski', GMINA),
  official('Aleksandra', 'Lubańska', 'Radna miejska', GMINA),
  official('Rajmund', 'Oskierko', 'Radny miejski', GMINA),
  official('Małgorzata', 'Rutkowska', 'Radna miejska', GMINA),
  official('Marcin', 'Sowidzki', 'Radny miejski', GMINA),
  official('Tomasz', 'Strakacz', 'Radny miejski', GMINA),
  official('Zbigniew', 'Szelenbaum', 'Radny miejski', GMINA),
  official('Krystyna', 'Tenderenda', 'Radna miejska', GMINA),
  official('Lech', 'Toruszewski', 'Radny miejski', GMINA),
];

/** Zarząd Powiatu + Rada Powiatu (VII kadencji, lista ze strony PWZ). */
const POWIAT_OFFICIALS: PublicOfficial[] = [
  official('Romuald', 'Reszka', 'Starosta Warszawski Zachodni', POWIAT),
  official('Wiesław', 'Pszczółkowski', 'Wicestarosta', POWIAT),
  official('Ewelina', 'Degowska', 'Członkini Zarządu Powiatu', POWIAT),
  official('Witold', 'Malarowski', 'Członek Zarządu Powiatu', POWIAT),
  official('Michał', 'Gajewski', 'Przewodniczący Rady Powiatu', POWIAT),
  official('Anna', 'Bernatowicz-Sobiech', 'Wiceprzewodnicząca Rady Powiatu', POWIAT),
  official('Andrzej', 'Wołczyński', 'Radny powiatowy', POWIAT),
  official('Anna', 'Kuncewicz', 'Radna powiatowa', POWIAT),
  official('Anna', 'Rudzka', 'Radna powiatowa', POWIAT),
  official('Blanka', 'Jabłońska', 'Radna powiatowa', POWIAT),
  official('Grzegorz', 'Kołpaczyński', 'Radny powiatowy', POWIAT),
  official('Jakub', 'Jakubowski', 'Radny powiatowy', POWIAT),
  official('Jan', 'Żychliński', 'Radny powiatowy', POWIAT),
  official('Janusz', 'Zawadzki', 'Radny powiatowy', POWIAT),
  official('Katarzyna', 'Choroś', 'Radna powiatowa', POWIAT),
  official('Leszek', 'Tokarczyk', 'Radny powiatowy', POWIAT),
  official('Liliana', 'Duda', 'Radna powiatowa', POWIAT),
  official('Marek', 'Parafiniuk', 'Radny powiatowy', POWIAT),
  official('Mariusz', 'Latek', 'Radny powiatowy', POWIAT),
  official('Michał', 'Kanclerz', 'Radny powiatowy', POWIAT),
  official('Patryk', 'Luboiński', 'Radny powiatowy', POWIAT),
  official('Przemysław', 'Kubicki', 'Radny powiatowy', POWIAT),
  official('Robert', 'Duda', 'Radny powiatowy', POWIAT),
  official('Tomasz', 'Dąbrowski', 'Radny powiatowy', POWIAT),
  official('Tomasz', 'Rusinek', 'Radny powiatowy', POWIAT),
  official('Łukasz', 'Kudlicki', 'Radny powiatowy', POWIAT),
];

export const OFFICIALS: PublicOfficial[] = [...GMINA_OFFICIALS, ...POWIAT_OFFICIALS];
