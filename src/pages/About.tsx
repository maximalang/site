import React from 'react';
    import Header from '../components/Header';
    import Footer from '../components/Footer';

    const About: React.FC = () => {
      return (
        <div className="min-h-screen bg-white">
          <Header />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">About Us</h1>
            <div className="prose max-w-none">
              <p className="text-lg text-gray-700 mb-6">
                LootBox was founded in 2020 with a simple mission: to bring excitement and surprise to gamers worldwide through our unique mystery box system.
              </p>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Our History</h2>
              <p className="text-gray-700 mb-6">
                Starting as a small indie project, LootBox has grown into a trusted platform for gamers seeking thrilling loot experiences. We've distributed thousands of prizes and built a community of satisfied customers.
              </p>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Why Choose LootBox?</h2>
              <ul className="list-disc list-inside text-gray-700 mb-6">
                <li>Security: All transactions are protected with industry-standard encryption.</li>
                <li>Transparency: We clearly display odds and prize values for every box.</li>
                <li>Quality: Only premium, verified prizes from trusted partners.</li>
                <li>Guarantees: 100% satisfaction or your money back.</li>
              </ul>
            </div>
          </main>
          <Footer />
        </div>
      );
    };

    export default About;