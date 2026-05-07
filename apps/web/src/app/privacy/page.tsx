import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />
      <section className="container py-16 md:py-24 max-w-4xl">
        <h1 className="text-4xl font-bold tracking-tight mb-8">Privacy Policy</h1>
        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-muted-foreground">
          <p>Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-2xl font-semibold text-foreground mt-8">1. Information We Collect</h2>
          <p>
            When you interact with AgentDomain, we collect minimal information necessary to provide the service:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Wallet Addresses:</strong> We log public cryptographic wallet addresses used to pay for and own identities.</li>
            <li><strong>Domain Names:</strong> We store the requested domain names, Basenames, and ENS labels.</li>
            <li><strong>DNS Records:</strong> We store the DNS records you configure for your agent.</li>
            <li><strong>Email Metadata:</strong> We store metadata (sender, recipient, subject, headers) of emails routed through our platform to prevent abuse.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-foreground mt-8">2. Blockchain Immutability Notice</h2>
          <p>
            Please note that AgentDomain interacts with public blockchains (Base and Ethereum). Data published 
            to a public blockchain, including wallet addresses and ownership records of AgentID NFTs, is 
            <strong>immutable and public by design</strong>. We cannot delete or modify data that has been 
            written to the blockchain.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8">3. How We Use Your Information</h2>
          <p>
            We use the collected information solely for the following purposes:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>To provision and maintain your agent's identity bundle.</li>
            <li>To facilitate automatic renewals via the RenewalVault smart contract.</li>
            <li>To route inbound and outbound emails securely.</li>
            <li>To prevent fraud, spam, and abuse of our infrastructure.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-foreground mt-8">4. Data Sharing with Third Parties</h2>
          <p>
            We do not sell your data. We share necessary data with essential third-party service providers 
            strictly to operate the service:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Spaceship/Namecheap:</strong> For ICANN domain registration compliance.</li>
            <li><strong>Cloudflare:</strong> For DNS management and proxying.</li>
            <li><strong>Resend / Amazon SES:</strong> For email delivery and routing.</li>
            <li><strong>Let's Encrypt:</strong> For issuing SSL certificates.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-foreground mt-8">5. Data Retention</h2>
          <p>
            We retain your data as long as your agent's identity is active. If an identity expires and is 
            not renewed, we may delete associated DNS records and email routing rules from our active databases, 
            though historical logs may be retained for security and audit purposes.
          </p>
        </div>
      </section>
      <Footer />
    </main>
  );
}
