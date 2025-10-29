import React, { useState } from 'react';
import { Search } from 'lucide-react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import ProductCard from '../components/ProductCard';

const Prizes: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRarity, setFilterRarity] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sortBy, setSortBy] = useState('name');

  const prizes = [
    { id: '1', name: 'Gaming Mouse', price: 20, description: 'Ergonomic wireless mouse', rarity: 'Common', category: 'Accessory', image: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400&h=300&fit=crop' },
    { id: '2', name: 'Steam Key', price: 25, description: 'Digital game activation key', rarity: 'Rare', category: 'Digital', image: 'https://images.unsplash.com/photo-1556438064-2d7646166914?w=400&h=300&fit=crop' },
    { id: '3', name: 'T-shirt', price: 15, description: 'Branded gaming apparel', rarity: 'Uncommon', category: 'Clothing', image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=300&fit=crop' },
    { id: '4', name: 'Rare Skin', price: 50, description: 'Exclusive in-game cosmetic', rarity: 'Epic', category: 'Digital', image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=400&h=300&fit=crop' },
    { id: '5', name: 'Headphones', price: 30, description: 'High-quality gaming headset', rarity: 'Rare', category: 'Accessory', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop' },
    { id: '6', name: 'Controller', price: 40, description: 'Wireless game controller', rarity: 'Common', category: 'Accessory', image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=300&fit=crop' },
  ];

  const filteredPrizes = prizes
    .filter(prize =>
      prize.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (filterRarity === '' || prize.rarity === filterRarity) &&
      (filterCategory === '' || prize.category === filterCategory)
    )
    .sort((a, b) => {
      if (sortBy === 'price') return a.price - b.price;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">All Prizes</h1>
        <div className="mb-8 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search prizes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterRarity}
            onChange={(e) => setFilterRarity(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Rarities</option>
            <option value="Common">Common</option>
            <option value="Uncommon">Uncommon</option>
            <option value="Rare">Rare</option>
            <option value="Epic">Epic</option>
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            <option value="Accessory">Accessory</option>
            <option value="Digital">Digital</option>
            <option value="Clothing">Clothing</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="name">Sort by Name</option>
            <option value="price">Sort by Price</option>
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredPrizes.map((prize) => (
            <ProductCard key={prize.id} {...prize} />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Prizes;