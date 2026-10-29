# 🔭 SeePOO (`seepoo`) — Visualiseur & Bac à Sable POO Temps Réel

**SeePOO (`seepoo`)** est un outil pédagogique en ligne de commande (CLI) conçu pour les apprenants en **Bachelor 3 (B3) Développement**. Il connecte votre code JavaScript local à une interface web interactive permettant de :
1. **Planifier et visualiser vos Classes** (Analyse statique AST + Mode Brouillon `.poo-draft.json`).
2. **Manipuler vos Objets en mémoire** (Instanciation Drag & Drop, encapsulation des propriétés privées `#`, flèches de pointeurs mémoire, exécution réelle via `node:vm` et Time-Travel).

---

## 📦 Guide d'Installation pour les Apprenants (Dépôt Privé)

Le package `seepoo` étant hébergé sur un dépôt GitHub privé pédagogique, vous devez générer un jeton d'accès personnel (**Personal Access Token - PAT**) en **lecture seule** pour autoriser `npm` à le télécharger.

### Étape 1 : Générer votre Token GitHub en Lecture Seule (Read-Only)

1. Connectez-vous à votre compte [GitHub](https://github.com).
2. Cliquez sur votre avatar en haut à droite $\rightarrow$ **Settings** (Paramètres).
3. Tout en bas du menu latéral gauche, cliquez sur **Developer settings**.
4. Déroulez **Personal access tokens** $\rightarrow$ cliquez sur **Fine-grained tokens** (recommandé pour la sécurité).
5. Cliquez sur le bouton **Generate new token** :
   - **Token name** : `seepoo-student-readonly`
   - **Expiration** : `90 days` (ou la durée de votre module POO)
   - **Resource owner** : Sélectionnez l'organisation de l'école ou le compte enseignant si applicable
   - **Repository access** : Sélectionnez **All repositories** (ou **Only select repositories** $\rightarrow$ `seepoo`)
   - **Permissions** $\rightarrow$ **Repository permissions** :
     - Cherchez la ligne **Contents** et passez-la sur **Read-only** (Lecture seule).
     - *Aucune autre permission n'est nécessaire (`Metadata` sera automatiquement en `Read-only`).*
6. Cliquez sur **Generate token** en bas de page et **copiez immédiatement votre token** (il commence par `github_pat_...` ou `ghp_...`).

> [!IMPORTANT]
> Conservez ce token en lieu sûr et **ne le commitez jamais** dans vos dépôts Git d'exercices !

---

### Étape 2 : Installer l'outil globalement via `npm`

Ouvrez votre terminal et exécutez la commande suivante en remplaçant `<TOKEN>` par le jeton copié à l'étape 1 :

```bash
npm install -g git+https://<TOKEN>@github.com/mon-compte/seepoo.git
```

Vérifiez que l'installation a réussi :

```bash
seepoo --version
```

---

### Étape 3 : Initialiser et lancer `seepoo` dans votre projet JS

Placez-vous dans le dossier de votre exercice ou TP Orienté Objet :

```bash
cd mon-tp-poo
```

1. **(Optionnel) Initialiser le fichier de conception `.poo-draft.json`** :
   ```bash
   seepoo init
   ```
   Cette commande crée un fichier `.poo-draft.json` à la racine de votre projet pour sauvegarder vos classes planifiées depuis l'interface graphique.

2. **Démarrer le serveur d'analyse temps réel** :
   ```bash
   seepoo start
   ```
   *(Options disponibles : `seepoo start --port 4242 --dir ./src`)*

Votre navigateur s'ouvre automatiquement sur **`http://localhost:4242`** !
