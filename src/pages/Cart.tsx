import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import CartItem from '../components/CartItem';

const Cart: React.FC = () => {
  const [cartItems, setCartItems] = useState([
    { id: '1', name: 'Bronze Box', price: 5, quantity: 2, image: 'https://images.unsplash.com/photo-1601593346740-925612772716?w=100&h=100&fit=crop' },
    { id: '2', name: 'Gaming Mouse', price: 20, quantity: 1, image: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=100&h=100&fit=crop' },
  ]);
  const navigate = useNavigate();

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(id);
      return;
    }
    setCartItems(prev => prev.map(item => item.id === id ? { ...item, quantity } : item));
  };

  const removeItem = (id: string) => {
    setCartItems(prev => prev.filter(item => item.id !== id));
  };

  const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Your Cart</h1>
        {cartItems.length === 0 ? (
          <p className="text-gray-600">Your cart is empty.</p>
        ) : (
          <>
            <div className="space-y-4 mb-8">
              {cartItems.map((item) => (
                <CartItem
                  key={item.id}
                  {...item}
                  onUpdateQuantity={updateQuantity}
                  onRemove={removeItem}
                />
              ))}
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex justify-between items-center mb-4">
                <span className="text-xl font-semibold">Total: ${total}</span>
                <button
                  onClick={() => navigate('/checkout')}
                  className="bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Proceed to Checkout
                </button>
              </div>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Cart;