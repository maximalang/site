import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import Header from '../components/Header';
import Footer from '../components/Footer';
import ProductCard from '../components/ProductCard';

const Home: React.FC = () => {
  const [cart, setCart] = useState<{ id: string; name: string; price: number; quantity: number }[]>([]);

  const box = {
    id: 'random',
    name: 'Random Loot Box',
    price: 10,
    description: 'A mystery box with random prizes. Open and discover!',
    image: 'https://images.unsplash.com/photo-1601593346740-925612772716?w=400&h=300&fit=crop',
  };

  const prizes = [
    { id: '1', name: 'Gaming Mouse', price: 20, description: 'Ergonomic wireless mouse', rarity: 'Common', image: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400&h=300&fit=crop' },
    { id: '2', name: 'Steam Key', price: 25, description: 'Digital game activation key', rarity: 'Rare', image: 'https://images.unsplash.com/photo-1556438064-2d7646166914?w=400&h=300&fit=crop' },
    { id: '3', name: 'T-shirt', price: 15, description: 'Branded gaming apparel', rarity: 'Uncommon', image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=300&fit=crop' },
    { id: '4', name: 'Rare Skin', price: 50, description: 'Exclusive in-game cosmetic', rarity: 'Epic', image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=400&h=300&fit=crop' },
    { id: '5', name: 'Headphones', price: 30, description: 'High-quality gaming headset', rarity: 'Rare', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop' },
    { id: '6', name: 'Controller', price: 40, description: 'Wireless game controller', rarity: 'Common', image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=300&fit=crop' },
  ];

  const addToCart = (item: { id: string; name: string; price: number }) => {
    setCart(prev => {
      const existing = prev.find(cartItem => cartItem.id === item.id);
      if (existing) {
        return prev.map(cartItem => cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem);
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
    toast.success(`${item.name} added to cart!`);
  };

  const buyNow = (item: { id: string; name: string; price: number }) => {
    toast.success(`Purchasing ${item.name}...`);
    // Simulate purchase
  };

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main className="pt-8">
        <section id="box" className="py-8 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotateY: 45 }}
              whileInView={{ opacity: 1, scale: 1, rotateY: 0 }}
              transition={{ duration: 1, type: "spring", stiffness: 80 }}
              viewport={{ once: true }}
              className="text-center mb-6"
              style={{ transformStyle: "preserve-3d", perspective: "1000px" }}
            >
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Random Loot Box</h2>
              <motion.div
                whileHover={{ scale: 1.05, rotateY: 10, rotateX: 5 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="inline-block bg-white rounded-lg shadow-lg overflow-hidden"
                style={{ transformStyle: "preserve-3d" }}
              >
                <img src={box.image} alt={box.name} className="w-64 h-48 object-cover" />
                <div className="p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{box.name}</h3>
                  <p className="text-gray-600 mb-3 text-sm">{box.description}</p>
                  <p className="text-xl font-bold text-gray-900 mb-3">${box.price}</p>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => addToCart(box)}
                      className="bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors transform hover:scale-105 text-sm"
                    >
                      Add to Cart
                    </button>
                    <button
                      onClick={() => buyNow(box)}
                      className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-500 transition-colors transform hover:scale-105 text-sm"
                    >
                      Buy Now
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        <section className="py-8 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.h2
              initial={{ opacity: 0, x: -50, rotateY: -15 }}
              whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
              transition={{ duration: 0.8, type: "spring", stiffness: 100 }}
              viewport={{ once: true }}
              className="text-2xl font-bold text-center text-gray-900 mb-6"
              style={{ transformStyle: "preserve-3d" }}
            >
              Prizes You Can Buy
            </motion.h2>
            <motion.div
              initial={{ opacity: 0, y: 50, rotateX: 10 }}
              whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ duration: 0.8, delay: 0.2, type: "spring", stiffness: 100 }}
              viewport={{ once: true }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              style={{ transformStyle: "preserve-3d" }}
            >
              {prizes.map((prize, index) => (
                <motion.div
                  key={prize.id}
                  initial={{ opacity: 0, scale: 0.8, rotateY: index % 2 === 0 ? 15 : -15 }}
                  whileInView={{ opacity: 1, scale: 1, rotateY: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.1, type: "spring", stiffness: 120 }}
                  whileHover={{ scale: 1.05, rotateY: 5, rotateX: -5 }}
                  viewport={{ once: true }}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <ProductCard {...prize} />
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Home;