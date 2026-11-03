// Connexion a la base en ligne (Supabase). A remplir une fois, voir supabase/README.md.
// La cle "anon public" est faite pour etre visible : la securite repose sur les regles de la base.
var SL = self.SL = self.SL || {};
SL.config = Object.assign({
  supabaseUrl: 'https://ceyevsthyorzctrnoeao.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleWV2c3RoeW9yemN0cm5vZWFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNTA3NzEsImV4cCI6MjEwNzcyNjc3MX0.bYhCiDZXGz_Er3JhSPgoBumqTtgCEdngFd13v-lejbU',
}, SL.config || {});
