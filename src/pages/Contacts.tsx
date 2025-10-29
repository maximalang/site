import React from 'react';
    import { useForm } from 'react-hook-form';
    import { zodResolver } from '@hookform/resolvers/zod';
    import { z } from 'zod';
    import { toast } from 'react-toastify';
    import Header from '../components/Header';
    import Footer from '../components/Footer';
    import { Mail, MessageCircle, Hash } from 'lucide-react';

    const contactSchema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.string().email('Invalid email'),
      message: z.string().min(10, 'Message must be at least 10 characters'),
    });

    type ContactForm = z.infer<typeof contactSchema>;

    const Contacts: React.FC = () => {
      const { register, handleSubmit, formState: { errors }, reset } = useForm<ContactForm>({
        resolver: zodResolver(contactSchema),
      });

      const onSubmit = (data: ContactForm) => {
        toast.success('Message sent successfully!');
        reset();
      };

      return (
        <div className="min-h-screen bg-white">
          <Header />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Contact Us</h1>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-6">Get in Touch</h2>
                <div className="space-y-4">
                  <div className="flex items-center">
                    <Mail className="w-6 h-6 text-gray-900 mr-3" />
                    <span>info@lootbox.com</span>
                  </div>
                  <div className="flex items-center">
                    <MessageCircle className="w-6 h-6 text-gray-900 mr-3" />
                    <a href="https://t.me/lootbox" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700">Telegram</a>
                  </div>
                  <div className="flex items-center">
                    <Hash className="w-6 h-6 text-gray-900 mr-3" />
                    <a href="https://discord.gg/lootbox" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700">Discord</a>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                  <textarea
                    {...register('message')}
                    rows={5}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
                  />
                  {errors.message && <p className="text-red-500 text-sm">{errors.message.message}</p>}
                </div>
                <button
                  type="submit"
                  className="w-full bg-gray-900 text-white py-3 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Send Message
                </button>
              </form>
            </div>
          </main>
          <Footer />
        </div>
      );
    };

    export default Contacts;