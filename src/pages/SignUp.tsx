import {
  Mail,
  Lock,
  User,
  UserCircle,
  ArrowLeft,
  Check,
  X,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAppDispatch } from "../store/hooks";
import { showToast } from "../store/slices/toastSlice";
import { logger } from "../utils/logger";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { fetchWithTimeout } from "../utils/security";

interface ValidationErrors {
  username?: string;
  email?: string;
  password?: string;
  fullName?: string;
}

interface AvailabilityStatus {
  username?: boolean | null; // true=available, false=taken, null=checking
  email?: boolean | null;
}

export default function SignUp() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loadingSignUp, setLoadingSignUp] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [availability, setAvailability] = useState<AvailabilityStatus>({});

  // Debounce timers for availability checks
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const emailDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const validateUsername = (value: string): string | undefined => {
    if (!value) return "Username is required";
    if (value.length < 3) return "Username must be at least 3 characters";
    if (value.length > 50) return "Username must be less than 50 characters";
    if (!/^[a-zA-Z0-9_]+$/.test(value))
      return "Username can only contain letters, numbers, and underscores";
    return undefined;
  };

  const validateEmail = (value: string): string | undefined => {
    if (!value) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return "Please enter a valid email address";
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return "Password is required";
    if (value.length < 8) return "Password must be at least 8 characters";
    return undefined;
  };

  // Debounced availability check
  const checkAvailability = async (
    field: "username" | "email",
    value: string
  ) => {
    if (field === "username") {
      if (!value || validateUsername(value)) return; // Skip if validation fails
    } else if (field === "email") {
      if (!value || validateEmail(value)) return; // Skip if validation fails
    }

    const params = new URLSearchParams();
    if (field === "username") params.append("username", value);
    if (field === "email") params.append("email", value);

    try {
      setAvailability((prev) => ({ ...prev, [field]: null })); // Show checking state
      const res = await fetchWithTimeout(
        `${API_BASE_URL + API_ENDPOINTS.AVAILABILITY}?${params.toString()}`,
        { method: "GET" }
      );

      if (res.ok) {
        const data = await res.json();
        if (field === "username") {
          setAvailability((prev) => ({
            ...prev,
            username: data.usernameAvailable,
          }));
        } else if (field === "email") {
          setAvailability((prev) => ({
            ...prev,
            email: data.emailAvailable,
          }));
        }
      }
    } catch (error) {
      console.error(`Failed to check ${field} availability:`, error);
    }
  };

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    // Clear previous timeout
    if (usernameDebounceRef.current) {
      clearTimeout(usernameDebounceRef.current);
    }
    // Set new debounced check (400ms)
    usernameDebounceRef.current = setTimeout(() => {
      checkAvailability("username", value);
    }, 400);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    // Clear previous timeout
    if (emailDebounceRef.current) {
      clearTimeout(emailDebounceRef.current);
    }
    // Set new debounced check (400ms)
    emailDebounceRef.current = setTimeout(() => {
      checkAvailability("email", value);
    }, 400);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const validationErrors: ValidationErrors = {
      username: validateUsername(username),
      email: validateEmail(email),
      password: validatePassword(password),
    };

    setErrors(validationErrors);

    // Check if there are any errors
    if (Object.values(validationErrors).some((error) => error !== undefined)) {
      dispatch(
        showToast({
          message: "Please fix the validation errors",
          type: "error",
        })
      );
      return;
    }

    // Check real-time availability status
    if (availability.username === false || availability.email === false) {
      dispatch(
        showToast({
          message:
            availability.username === false
              ? "Username is already taken"
              : "Email is already in use",
          type: "error",
        })
      );
      return;
    }

    setLoadingSignUp(true);
    try {
      const res = await fetchWithTimeout(
        API_BASE_URL + API_ENDPOINTS.REGISTER,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include", // needed to receive httpOnly refresh cookie
          body: JSON.stringify({
            username,
            email,
            password,
            fullName: fullName || undefined, // Send only if provided
          }),
        }
      );

      let data: any = null;

      // Only parse JSON if we can, safely
      try {
        data = await res.json();
      } catch (parseError) {
        console.error("Failed to parse signup response:", parseError);
        if (!res.ok) {
          dispatch(
            showToast({
              message: "Sign up failed. Please try again.",
              type: "error",
            })
          );
          setLoadingSignUp(false);
          return;
        }
      }

      setLoadingSignUp(false);

      if (res.status === 201 || res.status === 200) {
        dispatch(
          showToast({
            message: "Account created successfully! Please sign in.",
            type: "success",
          })
        );
        setTimeout(() => {
          navigate("/login");
        }, 1500);
      } else {
        // Generic error message - don't expose server error directly
        const errorMsg =
          data && typeof data.error === "string"
            ? data.error
            : "Sign up failed. Please try again.";
        dispatch(
          showToast({
            message: errorMsg,
            type: "error",
          })
        );
      }
    } catch (error) {
      logger.error("Sign up failed", { data: { error } });
      setLoadingSignUp(false);
      dispatch(
        showToast({
          message: "Network error. Please check your connection.",
          type: "error",
        })
      );
    }
  };

  return (
    <div className="flex flex-col h-full p-6">
      <button
        onClick={() => navigate("/login")}
        className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm">Back to Sign In</span>
      </button>

      <div className="flex-1 flex flex-col justify-center">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2">Create Account</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Join Snippy and sync across devices
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Username *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="username_123"
                required
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 ${
                  errors.username
                    ? "border-red-500 focus:ring-red-500"
                    : "border-zinc-200 dark:border-zinc-800 focus:ring-gray-400 dark:focus:ring-gray-600"
                }`}
              />
            </div>
            {errors.username && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.username}
              </p>
            )}
            {!errors.username &&
              username &&
              availability.username !== undefined && (
                <div className="mt-1 flex items-center gap-1 text-xs">
                  {availability.username === null ? (
                    <>
                      <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                      <span className="text-blue-600 dark:text-blue-400">
                        Checking availability...
                      </span>
                    </>
                  ) : availability.username ? (
                    <>
                      <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                      <span className="text-green-600 dark:text-green-400">
                        Available
                      </span>
                    </>
                  ) : (
                    <>
                      <X className="h-3 w-3 text-red-600 dark:text-red-400" />
                      <span className="text-red-600 dark:text-red-400">
                        Already taken
                      </span>
                    </>
                  )}
                </div>
              )}
          </div>

          <div>
            <label
              htmlFor="fullName"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Full Name
            </label>
            <div className="relative">
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                className="w-full pl-10 pr-4 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Email *
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                placeholder="your@email.com"
                required
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 ${
                  errors.email
                    ? "border-red-500 focus:ring-red-500"
                    : "border-zinc-200 dark:border-zinc-800 focus:ring-gray-400 dark:focus:ring-gray-600"
                }`}
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.email}
              </p>
            )}
            {!errors.email && email && availability.email !== undefined && (
              <div className="mt-1 flex items-center gap-1 text-xs">
                {availability.email === null ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                    <span className="text-blue-600 dark:text-blue-400">
                      Checking availability...
                    </span>
                  </>
                ) : availability.email ? (
                  <>
                    <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                    <span className="text-green-600 dark:text-green-400">
                      Available
                    </span>
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3 text-red-600 dark:text-red-400" />
                    <span className="text-red-600 dark:text-red-400">
                      Already in use
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Password *
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 ${
                  errors.password
                    ? "border-red-500 focus:ring-red-500"
                    : "border-zinc-200 dark:border-zinc-800 focus:ring-gray-400 dark:focus:ring-gray-600"
                }`}
              />
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loadingSignUp}
            className={`w-full py-2.5 font-medium rounded-lg transition-colors ${
              loadingSignUp
                ? "bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed"
                : "bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900"
            }`}
          >
            {loadingSignUp ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Creating Account...
              </div>
            ) : (
              "Create Account"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
