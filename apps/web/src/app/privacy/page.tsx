import { ContentPage } from "@/components/content/ContentPage";
import { Section, H2, H3, P, UL } from "@/components/content/Prose";

export default function PrivacyPage() {
  return (
    <ContentPage title="Privacy Policy" updated="August 18, 2026">
      <Section>
        <H2>1. Overview</H2>
        <P>Oplier is an AI-powered platform for managing and executing RWA portfolios on-chain.</P>
        <P>This Privacy Policy explains what information Oplier collects, how it is used, and the controls available to you.</P>
        <P>Oplier does not use ad tracking and does not sell user data.</P>
      </Section>

      <Section>
        <H2>2. Identity and account information</H2>
        <P>Oplier uses wallet-based identity.</P>
        <P>There is no email account, username, or password.</P>
        <P>
          When you connect and sign in with a wallet, Oplier uses your wallet address as your account
          identity. The wallet address is associated with the application data required to provide the
          service.
        </P>
        <P>Oplier does not store your private key, seed phrase, or wallet password.</P>
      </Section>

      <Section>
        <H2>3. Information stored by Oplier</H2>
        <P>Oplier stores information required to operate the product.</P>

        <H3>Wallet address</H3>
        <P>Your connected wallet address is stored as your account identity.</P>

        <H3>Chat history</H3>
        <P>Oplier stores your Chat conversations so you can continue and review conversations within the product.</P>

        <H3>Memory Summary</H3>
        <P>
          Oplier can maintain a persistent Memory Summary that helps the AI understand your
          preferences, goals, and relevant long-term context across conversations.
        </P>
        <P>You can control Memory through Settings. You can turn Memory off and edit the Memory Summary.</P>

        <H3>System and UPM configurations</H3>
        <P>
          Oplier stores the configuration of the UPMs you create, including the conditions, actions,
          limits, and relevant lifecycle state needed to operate them.
        </P>

        <H3>Transaction records</H3>
        <P>Oplier stores records of transactions and execution activity carried out through the platform.</P>
        <P>These records support activity history, UPM execution tracking, and reporting of actual transaction status.</P>
      </Section>

      <Section>
        <H2>4. Information Oplier does not use</H2>
        <P>Oplier does not use user data for advertising profiles.</P>
        <P>Oplier does not sell user data to third parties.</P>
        <P>Oplier does not use ad trackers.</P>
      </Section>

      <Section>
        <H2>5. Cookies and local storage</H2>
        <P>
          Oplier uses cookies and browser local storage only for product functionality such as
          maintaining a session and remembering your selected theme.
        </P>
        <P>Oplier does not use cookies or local storage for advertising tracking.</P>
      </Section>

      <Section>
        <H2>6. How information is used</H2>
        <P>Oplier uses stored information to:</P>
        <UL>
          <li>Authenticate your wallet-based account</li>
          <li>Provide Chat and conversation continuity</li>
          <li>Maintain your Memory Summary when enabled</li>
          <li>Store and operate your UPM configurations</li>
          <li>Record transaction and execution activity</li>
          <li>Provide the portfolio management features of the platform</li>
          <li>Maintain product settings and preferences</li>
        </UL>
        <P>
          Oplier does not use your stored information to guarantee investment outcomes or to create
          individualized certainty about future market results.
        </P>
      </Section>

      <Section>
        <H2>7. Memory controls</H2>
        <P>Memory is optional.</P>
        <P>When Memory is enabled, Oplier can maintain a concise Memory Summary across conversations.</P>
        <P>You can:</P>
        <UL>
          <li>Turn Memory off</li>
          <li>Edit the Memory Summary</li>
          <li>Delete information you do not want retained</li>
        </UL>
        <P>
          Memory is intended for persistent user context. It is separate from current portfolio state,
          transaction history, and UPM execution state.
        </P>
      </Section>

      <Section>
        <H2>8. Blockchain information</H2>
        <P>Transactions submitted on-chain are recorded on the relevant blockchain.</P>
        <P>Blockchain data is public and may remain available independently of Oplier.</P>
        <P>Oplier cannot remove or alter information that has already been permanently recorded on a public blockchain.</P>
      </Section>

      <Section>
        <H2>9. Third-party services</H2>
        <P>Oplier relies on infrastructure and external data services to provide the product.</P>
        <P>
          These services may process information required to perform the requested service, such as
          authentication, data retrieval, blockchain execution, or application infrastructure.
        </P>
        <P>Oplier does not authorize these services to use Oplier user data for ad tracking or to sell Oplier user data.</P>
      </Section>

      <Section>
        <H2>10. Security</H2>
        <P>
          Oplier uses wallet-based authentication and application-level controls designed to limit
          access to account data and transaction functionality.
        </P>
        <P>Oplier does not receive or store your private key through the application.</P>
        <P>
          No online service can guarantee absolute security. You remain responsible for securing your
          wallet and approving wallet signatures carefully.
        </P>
      </Section>

      <Section>
        <H2>11. Changes to this policy</H2>
        <P>Oplier may update this Privacy Policy as the product changes.</P>
        <P>The latest version will be published on this page with an updated date.</P>
      </Section>

      <Section>
        <H2>12. Contact</H2>
        <P>For privacy questions or requests, use the contact method provided by Oplier in the application or official product website.</P>
      </Section>
    </ContentPage>
  );
}
