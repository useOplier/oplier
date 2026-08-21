import { ContentPage } from "@/components/content/ContentPage";
import { Section, H2, P, UL } from "@/components/content/Prose";

export default function TermsPage() {
  return (
    <ContentPage title="Terms of Service" updated="August 18, 2026">
      <Section>
        <H2>1. Acceptance of these Terms</H2>
        <P>By connecting a wallet, signing in, or using Oplier, you agree to these Terms of Service.</P>
        <P>If you do not agree to these Terms, do not use the service.</P>
      </Section>

      <Section>
        <H2>2. Description of the service</H2>
        <P>Oplier is an AI-powered platform for managing and executing RWA portfolios on-chain.</P>
        <P>The service provides:</P>
        <UL>
          <li>Portfolio information and position views</li>
          <li>AI Chat for portfolio questions and analysis</li>
          <li>Fundamental and event analysis</li>
          <li>One-off transaction preparation and execution</li>
          <li>UPM creation and management</li>
          <li>UPM monitoring and autonomous execution</li>
          <li>Activity and execution history</li>
          <li>Account and Memory controls</li>
        </UL>
        <P>Oplier is a portfolio management platform. It is not a general-purpose AI assistant.</P>
      </Section>

      <Section>
        <H2>3. Wallet-based access</H2>
        <P>Oplier uses wallet-based authentication.</P>
        <P>There is no email, username, or password login.</P>
        <P>
          Your wallet is your account identity. You are responsible for maintaining control of your
          wallet and for reviewing wallet signatures and transaction requests before approving them.
        </P>
        <P>Oplier does not have access to your private key or seed phrase.</P>
      </Section>

      <Section>
        <H2>4. Your responsibilities</H2>
        <P>You are responsible for:</P>
        <UL>
          <li>Maintaining control of your wallet</li>
          <li>Reviewing transaction details before signing</li>
          <li>Ensuring you have the right to use the assets and accounts connected to Oplier</li>
          <li>Providing accurate information when configuring UPMs</li>
          <li>Reviewing UPM conditions, actions, limits, and permissions before activation</li>
          <li>Monitoring your portfolio and UPMs</li>
          <li>Complying with applicable laws and regulations in your jurisdiction</li>
          <li>Using Oplier only for lawful purposes</li>
        </UL>
        <P>
          You must not attempt to bypass product controls, exploit the service, or use Oplier to
          conduct prohibited or unlawful activity.
        </P>
      </Section>

      <Section>
        <H2>5. AI analysis and financial disclaimer</H2>
        <P>Oplier provides analysis, interpretation, and recommendations based on available data and your request.</P>
        <P>Oplier does not guarantee future market outcomes.</P>
        <P>
          The AI does not claim certainty about whether an asset will rise or fall, what an asset will
          be worth at a future time, whether a trade will be profitable, or whether a strategy will
          avoid losses.
        </P>
        <P>Oplier distinguishes facts from analysis and recommendations.</P>
        <P>
          Any recommendation produced by Oplier is analysis, not a guarantee, instruction from a
          financial adviser, or promise of performance.
        </P>
        <P>You remain responsible for your own investment decisions.</P>
      </Section>

      <Section>
        <H2>6. Transaction approval</H2>
        <P>For one-off transactions, Oplier prepares the transaction and presents it for your approval.</P>
        <P>
          The transaction is not authorized merely because the AI prepared it or because you selected
          an approval action inside the application.
        </P>
        <P>Your wallet signature is the final authorization for a one-off transaction.</P>
        <P>Oplier reports the actual execution result and does not assume that an approved transaction succeeded.</P>
      </Section>

      <Section>
        <H2>7. UPMs and autonomous execution</H2>
        <P>UPMs are designed to execute defined actions automatically after activation.</P>
        <P>
          When you activate a UPM, you authorize the permissions required for that UPM to operate
          within its configured limits.
        </P>
        <P>
          UPMs execute according to their defined conditions and actions. They do not require a new AI
          decision or manual approval after every trigger.
        </P>
        <P>
          You are responsible for reviewing a UPM before activation and for monitoring its status,
          limits, permissions, and execution history.
        </P>
        <P>
          Pausing a UPM stops execution while preserving its state. Deleting a UPM removes it and
          revokes its delegated execution permission where applicable.
        </P>
      </Section>

      <Section>
        <H2>8. Smart contract and blockchain risks</H2>
        <P>
          Oplier interacts with blockchain networks, smart contracts, wallets, and on-chain execution
          infrastructure.
        </P>
        <P>Blockchain transactions can be irreversible.</P>
        <P>Smart contracts may contain vulnerabilities, bugs, economic risks, or unexpected behavior.</P>
        <P>
          Blockchain networks may experience congestion, outages, reorganization, execution failures,
          pricing differences, or other technical conditions that affect transactions.
        </P>
        <P>
          Transaction fees, execution prices, slippage, liquidity, and final received amounts may
          differ from estimates.
        </P>
        <P>
          A UPM may fail to execute, execute later than expected, or execute at a different price than
          anticipated because of blockchain or market conditions.
        </P>
        <P>
          Oplier does not guarantee uninterrupted availability, execution at a particular price, or
          successful completion of every transaction.
        </P>
      </Section>

      <Section>
        <H2>9. Asset and market risks</H2>
        <P>
          Digital representations of real-world assets carry market, liquidity, counterparty, issuer,
          regulatory, and technical risks.
        </P>
        <P>The availability of an asset on Oplier does not mean that the asset is risk-free or suitable for you.</P>
        <P>Asset prices can fall. Liquidity can change. Market conditions can move rapidly.</P>
        <P>Oplier does not guarantee the value, liquidity, redeemability, or future performance of any asset.</P>
      </Section>

      <Section>
        <H2>10. Testnet phase</H2>
        <P>Oplier is currently in a testnet phase.</P>
        <P>
          During the testnet phase, testnet assets and tokens are used for testing and validation.
          Testnet funds and tokens have no real-world monetary value.
        </P>
        <P>
          You should not treat testnet balances, transactions, or assets as real investments or as
          evidence of future economic value.
        </P>
        <P>Testnet availability, behavior, liquidity, contracts, and execution environments can change without notice.</P>
      </Section>

      <Section>
        <H2>11. No warranty</H2>
        <P>Oplier is provided on an as-is and as-available basis to the maximum extent permitted by applicable law.</P>
        <P>Oplier does not warrant that:</P>
        <UL>
          <li>The service will always be available</li>
          <li>Data will always be complete, current, or error-free</li>
          <li>AI analysis will always be accurate</li>
          <li>A transaction will succeed</li>
          <li>A UPM will execute as intended in every circumstance</li>
          <li>A specific price or execution result will be achieved</li>
          <li>The service will be free from bugs, interruptions, or security incidents</li>
        </UL>
      </Section>

      <Section>
        <H2>12. Limitation of liability</H2>
        <P>
          To the maximum extent permitted by applicable law, Oplier and its operators, contributors,
          and service providers are not liable for indirect, incidental, special, consequential,
          exemplary, or punitive damages arising from or related to your use of the service.
        </P>
        <P>
          This includes losses arising from market movements, lost profits, loss of digital assets,
          failed or delayed transactions, smart contract behavior, blockchain failures, wallet
          compromise, unauthorized access resulting from your actions, or reliance on AI analysis.
        </P>
        <P>Nothing in these Terms excludes liability that cannot legally be excluded or limited under applicable law.</P>
      </Section>

      <Section>
        <H2>13. Third-party services</H2>
        <P>
          Oplier may rely on third-party infrastructure, blockchain networks, wallet software, market
          data providers, smart contracts, and other services.
        </P>
        <P>
          Oplier does not control third-party networks or services and is not responsible for their
          availability, performance, security, or changes.
        </P>
        <P>Your use of third-party services may also be subject to their own terms.</P>
      </Section>

      <Section>
        <H2>14. Suspension and termination</H2>
        <P>
          Oplier may suspend or terminate access where necessary to protect the service, comply with
          law, address abuse, or respond to security or operational issues.
        </P>
        <P>You may stop using Oplier at any time.</P>
        <P>Ending access to Oplier does not reverse blockchain transactions already submitted or recorded on-chain.</P>
      </Section>

      <Section>
        <H2>15. Changes to these Terms</H2>
        <P>Oplier may update these Terms as the service develops.</P>
        <P>The latest version will be published on this page with an updated date.</P>
      </Section>

      <Section>
        <H2>16. Governing law</H2>
        <P>
          These Terms are governed by the laws applicable to the Oplier entity operating the service,
          subject to any mandatory legal protections that apply in your jurisdiction.
        </P>
      </Section>

      <Section>
        <H2>17. Contact</H2>
        <P>For questions about these Terms, use the contact method provided by Oplier in the application or official product website.</P>
      </Section>
    </ContentPage>
  );
}
