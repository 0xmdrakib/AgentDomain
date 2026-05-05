import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <section className="container py-16 md:py-24 max-w-4xl">
        <h1 className="text-4xl font-bold tracking-tight mb-8">Terms of Service</h1>
        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-muted-foreground">
          <p>Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-2xl font-semibold text-foreground mt-8">1. Acceptance of Terms</h2>
          <p>
            By using AgentDomain ("Service"), you agree to be bound by these Terms of Service. 
            If you do not agree to these terms, please do not use our Service. The Service is designed 
            to provide autonomous AI agents and their operators with a comprehensive identity bundle, 
            including ICANN domains, on-chain names (Basenames, ENS), and associated infrastructure.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8">2. Web3 and Smart Contract Risks</h2>
          <p>
            AgentDomain utilizes blockchain technology, including smart contracts deployed on the Base network. 
            You acknowledge that interacting with smart contracts involves inherent risks, including but not 
            limited to bugs, vulnerabilities, and regulatory changes. We provide the "RenewalVault" and 
            "AgentID NFT" smart contracts "AS IS" without warranties of any kind. You are solely responsible 
            for the security of your private keys and wallets.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8">3. Domain Registration and Compliance</h2>
          <p>
            All ICANN domain registrations are fulfilled through third-party registrars (e.g., Spaceship). 
            By registering a domain, you agree to comply with ICANN's Uniform Domain Name Dispute Resolution 
            Policy (UDRP) and the registrar's terms of service. We reserve the right to suspend or revoke 
            domain access if the domain is used for phishing, malware distribution, illegal activities, or 
            violates our acceptable use policy.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8">4. Payments and Non-Refundability</h2>
          <p>
            Payments for the Service are made in cryptocurrency (USDC) via the x402 protocol or standard 
            on-chain transfers. Due to the immutable nature of blockchain transactions and the upfront 
            costs of ICANN domain registrations, <strong>all payments are final and non-refundable</strong>.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8">5. Autonomous Auto-Renewal</h2>
          <p>
            If you enable Auto-Renew via the RenewalVault smart contract, you authorize our Keeper Bots 
            to deduct the required USDC amount from your vault balance to renew your identity bundle. 
            It is your responsibility to maintain sufficient funds in the vault. If a renewal fails due 
            to insufficient funds, your domain and associated services may expire and be lost.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8">6. Email Service Usage</h2>
          <p>
            The email infrastructure provided via the Service is intended for autonomous agent communication. 
            You agree not to use the email service to send unsolicited bulk emails (spam). We actively monitor 
            bounce rates and spam reports. High bounce rates or abuse reports may result in immediate suspension 
            of your email sending capabilities without notice.
          </p>
        </div>
      </section>
      <Footer />
    </main>
  );
}
