/**
 * Représente un compte bancaire avec encapsulation du solde.
 */
class CompteBancaire {
  #solde = 0;

  /**
   * Initialise un nouveau compte bancaire
   * @param {string} titulaire - Nom du propriétaire
   * @param {number} soldeInitial - Solde à l'ouverture
   */
  constructor(titulaire = "Alice", soldeInitial = 100) {
    this.titulaire = titulaire;
    this.devise = "EUR";
    this.#solde = Number(soldeInitial);
  }

  /**
   * Ajoute de l'argent sur le compte
   * @param {number} montant - Montant positif à créditer
   */
  deposer(montant = 50) {
    const valeur = Number(montant);
    if (valeur <= 0) throw new Error("Le montant doit être positif");
    this.#solde += valeur;
    console.log(`Dépôt de ${valeur}€ effectué sur le compte de ${this.titulaire}`);
    return this.#solde;
  }

  /**
   * Retire de l'argent si le solde (incluant les frais) est suffisant
   * @param {number} montant - Montant à débiter
   */
  retirer(montant = 20) {
    const valeur = Number(montant);
    const frais = this.#calculerFrais(valeur);
    if (valeur + frais > this.#solde) {
      throw new Error("Solde insuffisant !");
    }
    this.#solde -= (valeur + frais);
    return this.#solde;
  }

  /**
   * Transfère un montant vers une autre instance de CompteBancaire
   * @param {CompteBancaire} compteDestinataire - Référence (@ref:id) du compte cible
   * @param {number} montant - Somme à transférer
   */
  transfererVers(compteDestinataire, montant = 30) {
    this.retirer(montant);
    compteDestinataire.deposer(montant);
    this.dernierBeneficiaire = compteDestinataire;
    return `Transfert de ${montant}€ vers ${compteDestinataire.titulaire} réussi`;
  }

  /**
   * Méthode privée calculant les frais bancaires internes
   */
  #calculerFrais(montant) {
    return montant > 500 ? 2 : 0;
  }
}
