import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getPool } from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // 1. Inject user.id into the JWT token on sign-in
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.picture = user.image;
      }
      return token;
    },
    // 2. Expose the token.id to the client session
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.image = token.picture;
      return session;
    },
    // 3. Ensure user exists in our database
    async signIn({ user, account }) {
      if (account.provider === "google") {
        try {
          const pool = getPool();
          await pool.query(
            `INSERT INTO treelife_users (id, name, email, image, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (id) DO UPDATE SET name = $2, image = $4`,
            [user.id, user.name, user.email, user.image]
          );
        } catch (err) {
          console.error("[auth] Failed to upsert user:", err.message);
        }
      }
      return true;
    },
  },
  pages: {
    signIn: "/",  // Redirect to home page for sign-in
  },
});
