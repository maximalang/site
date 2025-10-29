import React, { useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../components/Header';
import Footer from '../components/Footer';
import BoxOpeningAnimation from '../components/BoxOpeningAnimation';

const Boxes: React.FC = () => {
  const [cart, setCart] = useState<{ id: string; name: string; price: number; quantity: number }[]>([]);

  const boxes = [
    {
      id: 'bronze',
      name: 'Bronze Box',
      price: 5,
      description: 'Contains basic gaming accessories with a 10% chance for rare items.',
      prizes: [
        { name: 'Gaming Mouse', image: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=100&h=100&fit=crop' },
        { name: 'T-shirt', image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=100&h=100&fit=crop' },
      ],
    },
    {
      id: 'silver',
      name: 'Silver Box',
      price: 15,
      description: 'Balanced mix with 25% chance for rare items like Steam Keys.',
      prizes: [
        { name: 'Steam Key', image: 'https://images.unsplash.com/photo-1556438064-2d7646166914?w=100&h=100&fit=crop' },
        { name: 'Headphones', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=100&h=100&fit=crop' },
      ],
    },
    {
      id: 'gold',
      name: 'Gold Box',
      price: 30,
      description: 'Premium box with 50% chance for epic items including Rare Skins.',
      prizes: [
        { name: 'Rare Skin', image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=100&h=100&fit=crop' },
        { name: 'Controller', image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=100&h=100&fit=crop' },
      ],
    },
  ];

  const addToCart = (box: typeof boxes[0]) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === box.id);
      if (existing) {
        return prev.map(item => item.id === box.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { id: box.id, name: box.name, price: box.price, quantity: 1 }];
    });
    toast.success(`${box.name} added to cart!`);
  };

  const buyNow = (box: typeof boxes[0]) => {
    toast.success(`Purchasing ${box.name}...`);
    // Simulate purchase
  };

  const handlePrizeWon = (prize: { name: string; image: string }) => {
    toast.success(`Congratulations! You won: ${prize.name}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Our Boxes</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {boxes.map((box) => (
            <div key={box.id} className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{box.name}</h2>
              <p className="text-gray-600 mb-4">{box.description}</p>
              <p className="text-2xl font-bold text-blue-600 mb-4">${box.price}</p>
              <div className="flex space-x-4 mb-4">
                <button
                  onClick={() => addToCart(box)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Add to Cart
                </button>
                <button
                  onClick={() => buyNow(box)}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Buy Now
                </button>
              </div>
              <BoxOpeningAnimation prizes={box.prizes} onComplete={handlePrizeWon} />
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Boxes;