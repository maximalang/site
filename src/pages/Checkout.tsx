import React, { useState } from 'react';
    import { useForm } from 'react-hook-form';
    import { zodResolver } from '@hookform/resolvers/zod';
    import { z } from 'zod';
    import { toast } from 'react-toastify';
    import Header from '../components/Header';
    import Footer from '../components/Footer';

    const checkoutSchema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.string().email('Invalid email'),
      address: z.string().min(1, 'Address is required'),
      paymentMethod: z.enum(['card', 'crypto', 'paypal']),
    });

    type CheckoutForm = z.infer<typeof checkoutSchema>;

    const Checkout: React.FC = () => {
      const [cartItems] = useState([
        { id: '1', name: 'Bronze Box', price: 5, quantity: 2 },
        { id: '2', name: 'Gaming Mouse', price: 20, quantity: 1 },
      ]);
      const { register, handleSubmit, formState: { errors } } = useForm<CheckoutForm>({
        resolver: zodResolver(checkoutSchema),
      });

      const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

      const onSubmit = (data: CheckoutForm) => {
        toast.success('Order placed successfully!');
        console.log('Order data:', data);
      };

      return (
        <div className="min-h-screen bg-white">
          <Header />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-gray-50 p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-semibold mb-4">Order Summary</h2>
                {cartItems.map((item) => (
                  <div key={item.id} className="flex justify-between mb-2">
                    <span>{item.name} x{item.quantity}</span>
                    <span>${item.price * item.quantity}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-4">
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>${total}</span>
                  </div>
                </div>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 p-6 rounded-lg shadow-md space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    {...register('name')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
                  />
                  {errors.name && <p className="text-red-500 text-sm">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    {...register('email')}
                    type="email"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
                  />
                  {errors.email && <p className="text-red-500 text-sm">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <textarea
                    {...register('address')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
                  />
                  {errors.address && <p className="text-red-500 text-sm">{errors.address.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select
                    {...register('paymentMethod')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
                  >
                    <option value="card">Credit Card</option>
                    <option value="crypto">Cryptocurrency</option>
                    <option value="paypal">PayPal</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full bg-gray-900 text-white py-3 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Place Order
                </button>
              </form>
            </div>
          </main>
          <Footer />
        </div>
      );
    };

    export default Checkout;