/**
 * Représente un client de la banque pouvant détenir une référence vers un CompteBancaire.
 */
class Client {
  #codeSecret = "1234";

  /**
   * Crée un client
   * @param {string} nom - Nom complet du client
   * @param {CompteBancaire} comptePrincipal - Référence vers un objet CompteBancaire
   */
  constructor(nom = "Bob Martin", comptePrincipal = null) {
    this.nom = nom;
    this.comptePrincipal = comptePrincipal;
  }

  /**
   * Associe une instance de CompteBancaire à ce client (crée un pointeur mémoire !)
   * @param {CompteBancaire} compte - Utiliser @ref:id_du_compte
   */
  associerCompte(compte) {
    this.comptePrincipal = compte;
    return `Compte de ${compte.titulaire} associé à ${this.nom}`;
  }
}
