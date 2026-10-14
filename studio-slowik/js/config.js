// Connexion a la base en ligne (Supabase). A remplir une fois, voir supabase/README.md.
// La cle "anon public" est faite pour etre visible : la securite repose sur les regles de la base.
var SL = self.SL = self.SL || {};
SL.config = Object.assign({
  supabaseUrl: '',      // ex : 'https://abcdefgh.supabase.co'
  supabaseAnonKey: '',  // ex : 'eyJhbGciOiJIUzI1NiIs...'
}, SL.config || {});
