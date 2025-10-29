import React from 'react';
import { Facebook, Twitter, Instagram, Mail, MessageCircle, Hash } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-100 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">LootBox</h3>
            <p className="text-gray-600">Open the box and get a prize!</p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Us</h3>
            <div className="space-y-2">
              <a href="mailto:info@lootbox.com" className="flex items-center text-gray-600 hover:text-gray-900 transition-colors">
                <Mail size={16} className="mr-2" /> info@lootbox.com
              </a>
              <a href="https://t.me/lootbox" target="_blank" rel="noopener noreferrer" className="flex items-center text-gray-600 hover:text-gray-900 transition-colors">
                <MessageCircle size={16} className="mr-2" /> Telegram
              </a>
              <a href="https://discord.gg/lootbox" target="_blank" rel="noopener noreferrer" className="flex items-center text-gray-600 hover:text-gray-900 transition-colors">
                <Hash size={16} className="mr-2" /> Discord
              </a>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Follow Us</h3>
            <div className="flex space-x-4">
              <a href="https://facebook.com/lootbox" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900 transition-colors">
                <Facebook size={20} />
              </a>
              <a href="https://twitter.com/lootbox" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900 transition-colors">
                <Twitter size={20} />
              </a>
              <a href="https://instagram.com/lootbox" target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-gray-900 transition-colors">
                <Instagram size={20} />
              </a>
            </div>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-600">&copy; 2025 LootBox. All rights reserved.</p>
          <div className="flex space-x-4 mt-4 md:mt-0">
            <a href="/privacy" className="text-gray-600 hover:text-gray-900 transition-colors">Privacy Policy</a>
            <a href="/terms" className="text-gray-600 hover:text-gray-900 transition-colors">Terms of Service</a>
          </div>
        </div>
        <p className="text-center text-gray-500 mt-4">Built with ❤️ by <a rel="nofollow" target="_blank" href="https://meku.dev" className="text-gray-900 hover:underline">Meku.dev</a></p>
      </div>
    </footer>
  );
};

export default Footer;