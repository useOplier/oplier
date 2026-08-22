import { ContentPage } from "@/components/content/ContentPage";
import { Section, H2, H3, P, UL, OL, Quote } from "@/components/content/Prose";

export default function DocsPage() {
  return (
    <ContentPage title="Docs">
      <Section>
        <H2>What Oplier is</H2>
        <P>Oplier is an AI-powered platform for managing and executing RWA portfolios on-chain.</P>
        <P>
          You manage your portfolio through natural language. Oplier helps you understand assets and
          positions, analyze fundamental events, request transactions, and create automated position
          management instructions.
        </P>
        <P>Oplier is portfolio-focused. It is not a general-purpose AI assistant.</P>
      </Section>

      <Section>
        <H2>Sign in with your wallet</H2>
        <P>Oplier uses wallet-based sign-in.</P>
        <P>There is no email, username, or password. Your connected wallet is your identity in Oplier.</P>
        <P>
          To sign in, connect your wallet and complete the wallet signature request. Your wallet
          address is then used to associate your portfolio, conversations, UPMs, activity, and
          settings with your account.
        </P>
      </Section>

      <Section>
        <H2>Ask, Trade, Manage, Understand</H2>
        <P>Oplier is built around four core actions.</P>

        <H3>Ask</H3>
        <P>Use natural language to understand your assets, positions, portfolio, markets, and upcoming events.</P>
        <P>Examples:</P>
        <Quote>What is affecting my portfolio this week?</Quote>
        <Quote>What risks do you see around my AAPLx position?</Quote>
        <Quote>What upcoming events could affect the assets I hold?</Quote>

        <H3>Trade</H3>
        <P>Request RWA transactions through Chat without manually constructing the transaction flow.</P>
        <P>
          Oplier can analyze a request, prepare the transaction, and show the transaction for approval.
          You remain the final decision-maker. A one-off transaction is only executed after you approve
          it and complete the normal wallet signing flow.
        </P>

        <H3>Manage</H3>
        <P>Create UPMs that manage positions automatically based on conditions you define.</P>
        <P>
          A UPM can monitor supported conditions, execute defined actions, and continue managing the
          position without requiring you to remain online.
        </P>

        <H3>Understand</H3>
        <P>Get AI-driven insights and fundamental analysis before making decisions.</P>
        <P>
          Oplier uses portfolio context and approved external data to explain what is happening, why it
          matters, which positions may be affected, and what risks or uncertainties are relevant.
        </P>
        <P>The AI separates facts from interpretation. It does not present predictions as certainty.</P>
      </Section>

      <Section>
        <H2>AI Chat</H2>
        <P>Chat is the primary interface for working with Oplier.</P>
        <P>Use Chat to:</P>
        <UL>
          <li>Ask portfolio questions</li>
          <li>Review positions</li>
          <li>Request fundamental analysis</li>
          <li>Ask about current or upcoming events</li>
          <li>Create and modify UPMs</li>
          <li>Pause, resume, or delete UPMs</li>
          <li>Request one-off transactions</li>
          <li>Review relevant execution results</li>
        </UL>
        <P>
          Oplier can handle multiple independent conversations. Each conversation keeps its own
          context. A persistent Memory Summary can provide user context across conversations.
        </P>
        <P>
          The AI only works within supported portfolio and financial capabilities. It does not invent
          unsupported assets, actions, or UPM conditions.
        </P>
      </Section>

      <Section>
        <H2>Fundamental analysis</H2>
        <P>Oplier provides portfolio-contextual analysis rather than a generic news feed.</P>
        <P>The AI can analyze financial and economic events and explain:</P>
        <UL>
          <li>What happened or what is coming</li>
          <li>Why it matters</li>
          <li>Which holdings may be affected</li>
          <li>Potential positive or negative impact</li>
          <li>Relevant risk</li>
          <li>Uncertainty</li>
        </UL>
        <P>
          The product uses approved external sources for fundamental data. These include BLS public
          data, FRED, Federal Reserve sources, and SEC EDGAR.
        </P>
        <P>The AI does not claim certainty about future market outcomes. Analysis is analysis, not a guarantee.</P>
      </Section>

      <Section>
        <H2>Transactions</H2>
        <P>One-off transactions are separate from UPMs.</P>
        <P>
          When you request a transaction, Oplier prepares it through the application, validates the
          supported asset and action, and presents a transaction approval flow in Chat.
        </P>
        <P>You can approve or cancel the request.</P>
        <P>Approval does not itself sign the transaction. Your wallet signature remains the final authorization.</P>
        <P>Oplier reports the actual transaction result. It does not treat approval as proof that a transaction succeeded.</P>
      </Section>

      <Section>
        <H2>UPMs</H2>

        <H3>What is a UPM?</H3>
        <P>UPM stands for Unmanned Position Manager.</P>
        <P>A UPM manages a position autonomously without requiring you to remain online or manually execute each transaction.</P>
        <P>
          A UPM is a persistent set of defined conditions and actions for managing a position. You
          describe what you want in natural language. Oplier converts the request into a supported UPM
          configuration, validates it, and shows it to you before activation.
        </P>

        <H3>How a UPM works</H3>
        <P>The flow is simple:</P>
        <OL>
          <li>Describe the position management rule in Chat.</li>
          <li>Oplier structures the request into a supported UPM.</li>
          <li>The UPM is validated and shown to you.</li>
          <li>You activate the UPM and authorize its required permissions.</li>
          <li>The UPM monitors its defined conditions.</li>
          <li>When a condition is satisfied, the backend validates the action and executes it.</li>
          <li>The result is recorded in the UPM history and Activity.</li>
        </OL>
        <P>UPMs execute deterministically. The AI is not making a new decision each time a condition is checked.</P>

        <H3>Supported UPM conditions</H3>
        <P>UPMs can use supported conditions such as:</P>
        <UL>
          <li>Price reaching a defined value</li>
          <li>Price moving by a defined percentage</li>
          <li>Position ROI reaching a defined percentage</li>
          <li>A specific date or time</li>
          <li>A predefined High Impact News event within a supported time window</li>
        </UL>
        <P>UPMs use explicit actions and supported assets. Oplier does not silently change an unsupported request into something else.</P>

        <H3>UPM lifecycle</H3>
        <P>A UPM can be active, paused, halted, expired, or complete.</P>
        <P>Pausing stops execution without resetting the UPM state. Resuming continues from the existing state.</P>
        <P>A halted UPM stops after a non-retryable execution failure. Once the issue is addressed, it can be resumed from the failed step.</P>
        <P>An expired UPM stops executing when its expiration is reached.</P>
        <P>A completed UPM has finished its defined execution.</P>
        <P>Deleting a UPM removes it and revokes its delegated execution permission.</P>
      </Section>

      <Section>
        <H2>Positions</H2>
        <P>Positions shows the positions managed through Oplier.</P>
        <P>A position is created when the first execution of a UPM runs.</P>
        <P>Position details provide the current state of the position and its relevant execution context.</P>
        <P>A position is closed when its UPM is completed, halted, or expired.</P>
      </Section>

      <Section>
        <H2>Systems</H2>
        <P>The Systems screen is the control surface for UPMs.</P>
        <P>It shows your UPMs and their current state.</P>
        <P>Each UPM can show:</P>
        <UL>
          <li>Name and status</li>
          <li>What it does</li>
          <li>Conditions</li>
          <li>Actions</li>
          <li>Execution history</li>
          <li>Relevant errors or warnings</li>
          <li>Pause and resume controls</li>
          <li>Delete controls</li>
        </UL>
        <P>Opening a UPM shows its details and execution history.</P>
      </Section>

      <Section>
        <H2>Activity</H2>
        <P>Activity is the transaction and execution history for the account.</P>
        <P>It provides a record of transactions carried out through Oplier and relevant UPM execution activity.</P>
        <P>Oplier reports actual execution results rather than assuming that a requested or approved action succeeded.</P>
      </Section>

      <Section>
        <H2>Settings</H2>
        <P>Settings contains account controls that do not belong in the main workflow.</P>
        <P>Available controls include:</P>
        <UL>
          <li>Memory on or off</li>
          <li>Editable Memory Summary</li>
          <li>Time zone</li>
          <li>Maximum slippage</li>
        </UL>
        <P>The default maximum slippage is 1%.</P>
      </Section>

      <Section>
        <H2>Memory</H2>
        <P>Memory is a persistent summary about you that helps Oplier understand your preferences and goals across conversations.</P>
        <P>Memory can contain information such as:</P>
        <UL>
          <li>Persistent preferences</li>
          <li>Goals</li>
          <li>Stable working preferences</li>
          <li>Relevant financial preferences or perspectives</li>
          <li>Important long-term context that is useful in future conversations</li>
        </UL>
        <P>Memory is separate from ordinary Chat history.</P>
        <P>
          Memory does not store portfolio balances, transaction history, UPM state, private keys, seed
          phrases, wallet credentials, API keys, passwords, or other secrets as part of the Memory
          Summary.
        </P>
        <P>
          You control Memory. You can turn it off and edit the Memory Summary in Settings. You can also
          remove information you do not want retained.
        </P>
      </Section>

      <Section>
        <H2>Supported assets</H2>
        <P>Oplier works only with assets available in its supported asset registry.</P>
        <P>
          The registry defines each supported asset, including its symbol, contract address, chain,
          asset type, availability, supported actions, trading pairs, decimals, and price source.
        </P>
        <P>Oplier does not invent assets or contract addresses.</P>
        <P>
          Current testnet asset naming follows the mainnet-style xStocks convention for the RWA test
          assets. Supported RWA examples include:
        </P>
        <UL>
          <li>AAPLx</li>
          <li>METAx</li>
          <li>NVDAx</li>
          <li>GLDx</li>
        </UL>
        <P>USDG is the supported X Layer testnet stablecoin and is used as the default quote and settlement asset where applicable.</P>
        <P>
          The exact set of available assets can change by environment. Mainnet will support a
          significantly broader range of real-world assets than the current testnet environment,
          including additional RWA assets and additional stablecoins such as USDT and USDC.
        </P>
        <P>
          The testnet asset set is intentionally limited for testing. Mainnet will use the broader
          supported asset and execution environment defined for launch.
        </P>
      </Section>

      <Section>
        <H2>Current status</H2>
        <P>Oplier is currently in a testnet phase.</P>
        <P>
          The testnet is used to validate the product flow, portfolio management logic, UPM execution,
          transaction handling, and on-chain behavior before mainnet deployment.
        </P>
      </Section>
    </ContentPage>
  );
}
